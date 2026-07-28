import { ObjectId } from "mongodb";
import { getClient, getDb } from "@/lib/db/client";
import {
  COLLECTIONS,
  PROFESSIONS,
  ZERO_COUNT,
  type ShiftDoc,
  type StaffCount,
  type UserDoc,
} from "@/lib/db/schema";
import { ApiError, invalidInput, notFound } from "@/lib/errors";
import { buildShiftInterval, parseTime } from "@/lib/import/datetime";
import {
  changesAnything,
  computeEditConflicts,
  type EditConflict,
} from "./edit-conflicts";

/**
 * Shift creation, editing and deletion.
 *
 * Manual creation runs through the *same* time validation as the CSV importer
 * (`parseTime` + `buildShiftInterval`), so a manager cannot type in a shift the
 * importer would have rejected -- one set of rules about what a valid shift is.
 */

export interface ShiftInput {
  /** Clinic-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Clinic-local wall clock, `HH:MM`. */
  startTime: string;
  endTime: string;
  requirements: Partial<StaffCount>;
}

interface ResolvedInput {
  startAt: Date;
  endAt: Date;
  requirements: StaffCount;
}

function resolveInput(input: ShiftInput): ResolvedInput {
  const start = parseTime(input.startTime, "start time");
  if (!start.ok) throw invalidInput(start.reason);

  const end = parseTime(input.endTime, "end time");
  if (!end.ok) throw invalidInput(end.reason);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw invalidInput("Date must be in YYYY-MM-DD format.");
  }

  const interval = buildShiftInterval(input.date, start.value, end.value);
  if (!interval.ok) throw invalidInput(interval.reason);

  const requirements: StaffCount = { ...ZERO_COUNT, ...input.requirements };
  for (const profession of PROFESSIONS) {
    const value = requirements[profession];
    if (!Number.isInteger(value) || value < 0) {
      throw invalidInput(`Number of ${profession}s must be a whole number.`);
    }
  }
  if (PROFESSIONS.every((p) => requirements[p] === 0)) {
    throw invalidInput("A shift must require at least one member of staff.");
  }

  return { startAt: interval.value.startAt, endAt: interval.value.endAt, requirements };
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export async function createShift(input: ShiftInput): Promise<ShiftDoc> {
  const { startAt, endAt, requirements } = resolveInput(input);
  const db = await getDb();
  const now = new Date();

  const shift: ShiftDoc = {
    _id: new ObjectId(),
    externalId: null,
    startAt,
    endAt,
    requirements,
    filled: { ...ZERO_COUNT },
    claims: [],
    seriesId: null,
    occurrenceDate: null,
    detachedFromSeries: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<ShiftDoc>(COLLECTIONS.shifts).insertOne(shift);
  return shift;
}

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Deleting a claimed shift releases everyone on it. The bookings denormalised onto
 * each claimant must go too, or those people would keep blocking future claims
 * against a shift that no longer exists.
 */
export async function deleteShift(shiftId: ObjectId): Promise<void> {
  const client = await getClient();
  const db = await getDb();
  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      const shifts = db.collection<ShiftDoc>(COLLECTIONS.shifts);
      const users = db.collection<UserDoc>(COLLECTIONS.users);

      const shift = await shifts.findOne({ _id: shiftId }, { session });
      if (!shift) throw notFound("That shift");

      if (shift.claims.length > 0) {
        await users.updateMany(
          { _id: { $in: shift.claims.map((c) => c.userId) } },
          { $pull: { bookings: { shiftId } } },
          { session },
        );
      }

      await shifts.deleteOne({ _id: shiftId }, { session });
    });
  } finally {
    await session.endSession();
  }
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

export interface EditPreview {
  shift: ShiftDoc;
  proposed: ResolvedInput;
  conflicts: EditConflict[];
  /** Echoed back so the confirming request can prove it saw this exact state. */
  expectedUpdatedAt: string;
}

async function loadConflicts(
  shift: ShiftDoc,
  proposed: ResolvedInput,
  db: Awaited<ReturnType<typeof getDb>>,
  session?: import("mongodb").ClientSession,
): Promise<EditConflict[]> {
  if (shift.claims.length === 0) return [];

  const claimants = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .find({ _id: { $in: shift.claims.map((c) => c.userId) } }, { session })
    .toArray();

  const bookingsByUser = new Map(
    claimants.map((u) => [
      u._id.toHexString(),
      u.bookings.map((b) => ({
        shiftId: b.shiftId.toHexString(),
        startAt: b.startAt,
        endAt: b.endAt,
      })),
    ]),
  );

  return computeEditConflicts({
    shiftId: shift._id.toHexString(),
    startAt: proposed.startAt,
    endAt: proposed.endAt,
    requirements: proposed.requirements,
    claims: shift.claims.map((c) => ({
      userId: c.userId.toHexString(),
      name: c.name,
      profession: c.profession,
      claimedAt: c.claimedAt,
    })),
    bookingsByUser,
  });
}

/**
 * Dry run: what would this edit do to the people already on the shift?
 *
 * Returns the shift's current `updatedAt`, which the confirming request must send
 * back. If a claim lands in between, the confirm is refused and the manager is
 * shown the new situation rather than silently acting on a stale preview.
 */
export async function previewShiftEdit(
  shiftId: ObjectId,
  input: ShiftInput,
): Promise<EditPreview> {
  const proposed = resolveInput(input);
  const db = await getDb();

  const shift = await db
    .collection<ShiftDoc>(COLLECTIONS.shifts)
    .findOne({ _id: shiftId });
  if (!shift) throw notFound("That shift");

  return {
    shift,
    proposed,
    conflicts: await loadConflicts(shift, proposed, db),
    expectedUpdatedAt: shift.updatedAt.toISOString(),
  };
}

export interface ApplyEditResult {
  shift: ShiftDoc;
  released: EditConflict[];
}

export async function applyShiftEdit(
  shiftId: ObjectId,
  input: ShiftInput,
  expectedUpdatedAt: string | undefined,
): Promise<ApplyEditResult> {
  const proposed = resolveInput(input);
  const client = await getClient();
  const db = await getDb();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const shifts = db.collection<ShiftDoc>(COLLECTIONS.shifts);
      const users = db.collection<UserDoc>(COLLECTIONS.users);

      const shift = await shifts.findOne({ _id: shiftId }, { session });
      if (!shift) throw notFound("That shift");

      // Optimistic concurrency: refuse to act on a preview the manager saw before
      // someone else claimed or edited this shift.
      if (
        expectedUpdatedAt &&
        shift.updatedAt.toISOString() !== expectedUpdatedAt
      ) {
        throw new ApiError(
          "SHIFT_CHANGED",
          "This shift changed while you were editing it. Review the shift and try again.",
          409,
        );
      }

      if (!changesAnything(shift, { shiftId: shiftId.toHexString(), ...proposed })) {
        return { shift, released: [] };
      }

      const conflicts = await loadConflicts(shift, proposed, db, session);
      const releasedIds = new Set(conflicts.map((c) => c.userId));

      const keptClaims = shift.claims.filter(
        (c) => !releasedIds.has(c.userId.toHexString()),
      );

      // Recount from the surviving claims rather than decrementing, so the counter
      // is derived from the claim list it must agree with.
      const filled: StaffCount = { ...ZERO_COUNT };
      for (const claim of keptClaims) filled[claim.profession] += 1;

      await shifts.updateOne(
        { _id: shiftId },
        {
          $set: {
            startAt: proposed.startAt,
            endAt: proposed.endAt,
            requirements: proposed.requirements,
            claims: keptClaims,
            filled,
            updatedAt: new Date(),
          },
        },
        { session },
      );

      // Drop the bookings of everyone released.
      if (releasedIds.size > 0) {
        await users.updateMany(
          { _id: { $in: [...releasedIds].map((id) => new ObjectId(id)) } },
          { $pull: { bookings: { shiftId } } },
          { session },
        );
      }

      /*
       * Move the surviving claimants' denormalised bookings to the new times.
       * Skipping this would leave those users blocking future claims against the
       * shift's *old* hours -- the overlap rule would quietly use stale data.
       */
      if (keptClaims.length > 0) {
        await users.updateMany(
          {
            _id: { $in: keptClaims.map((c) => c.userId) },
            "bookings.shiftId": shiftId,
          },
          {
            $set: {
              "bookings.$[entry].startAt": proposed.startAt,
              "bookings.$[entry].endAt": proposed.endAt,
            },
          },
          { session, arrayFilters: [{ "entry.shiftId": shiftId }] },
        );
      }

      const updated = await shifts.findOne({ _id: shiftId }, { session });
      if (!updated) throw notFound("That shift");
      return { shift: updated, released: conflicts };
    });
  } finally {
    await session.endSession();
  }
}
