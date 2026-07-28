import { ObjectId, type ClientSession, type Db } from "mongodb";
import { getClient, getDb } from "@/lib/db/client";
import {
  COLLECTIONS,
  PROFESSION_LABEL,
  type Profession,
  type ShiftDoc,
  type UserDoc,
} from "@/lib/db/schema";
import { ApiError, notFound } from "@/lib/errors";
import { clinicDayKey, clinicTimeLabel, intervalsOverlap } from "@/lib/time";

/**
 * ============================================================================
 * The claim engine.
 * ============================================================================
 *
 * The brief requires that "a shift's availability should stay accurate no matter
 * how many people are acting on it at once". Two different mechanisms deliver
 * that, and it is worth being precise about which does what -- they are not the
 * same, and only one of them is a genuine design decision.
 *
 * ---------------------------------------------------------------------------
 * 1. CAPACITY -- protected by same-document contention, sharpened by a predicate
 * ---------------------------------------------------------------------------
 *
 * Every claimant for a shift writes that shift's document. MongoDB transactions
 * are snapshot-isolated with first-committer-wins detection, so two concurrent
 * writes to the same document raise a WriteConflict and `withTransaction` retries
 * the loser, which then re-reads and sees the slot gone. Overbooking is therefore
 * already impossible here, even without a filter predicate.
 *
 * The `$expr: { $lt: [filled.<prof>, requirements.<prof>] }` guard is still worth
 * having: it rejects in one round trip instead of aborting and retrying under
 * contention, and it keeps the rule true of the write itself rather than true only
 * as a consequence of the retry loop.
 *
 * ---------------------------------------------------------------------------
 * 2. OVERLAP -- protected by deliberately writing to the claimant's own document
 * ---------------------------------------------------------------------------
 *
 * This is the real decision. The natural way to check overlap is to query the
 * shifts collection for the person's other claims and then write only the shift.
 * That is wrong under concurrency: two claims by the same person on two *different*
 * overlapping shifts touch disjoint documents, so nothing collides, both commit,
 * and the person is double-booked. Snapshot isolation permits this -- it is
 * textbook write skew, and no amount of retrying detects it.
 *
 * So each claim also `$push`es onto the claimant's own `bookings` array, under a
 * `$not: { $elemMatch: <overlapping interval> }` predicate. That single array is
 * the contention point that makes two concurrent overlapping claims collide.
 *
 * This was verified rather than assumed: replacing the user-document write with a
 * shifts-collection query makes the write-skew tests fail with one nurse holding
 * both overlapping shifts (and 5 of 5 in the many-shift case). See
 * tests/integration/concurrency.test.ts.
 *
 * ---------------------------------------------------------------------------
 * Error handling
 * ---------------------------------------------------------------------------
 *
 * `withTransaction` re-runs the callback for errors labelled
 * TransientTransactionError. A business-rule rejection is a plain ApiError with no
 * such label, so it aborts cleanly and propagates on the first attempt rather than
 * spinning. (Measured: a thrown rule error aborts and rolls back in ~7ms.)
 *
 * Every operation passes `{ session }` and the callback awaits sequentially --
 * concurrent operations inside a transaction are undefined behaviour.
 */

export interface ClaimContext {
  shiftId: ObjectId;
  /** The person the shift is being claimed for. */
  targetUser: UserDoc;
  /** Who initiated it. Differs from targetUser when a manager assigns. */
  actorId: ObjectId;
}

/* -------------------------------------------------------------------------- */
/* Error constructors                                                          */
/* -------------------------------------------------------------------------- */

const describeShift = (shift: { startAt: Date; endAt: Date }) =>
  `${clinicDayKey(shift.startAt)} ${clinicTimeLabel(shift.startAt)}-${clinicTimeLabel(shift.endAt)}`;

function shiftFull(profession: Profession, required: number): ApiError {
  const label = PROFESSION_LABEL[profession];
  return new ApiError(
    "SHIFT_FULL",
    `This shift already has all ${required} ${required === 1 ? label.one : label.many} it needs.`,
    409,
    { profession, required },
  );
}

function wrongProfession(profession: Profession): ApiError {
  return new ApiError(
    "WRONG_PROFESSION",
    `This shift does not need any ${PROFESSION_LABEL[profession].many}.`,
    409,
    { profession },
  );
}

function overlapping(other: { startAt: Date; endAt: Date }): ApiError {
  return new ApiError(
    "OVERLAPPING_CLAIM",
    `This overlaps a shift already claimed on ${describeShift(other)}.`,
    409,
    { conflictsWith: describeShift(other) },
  );
}

const alreadyClaimed = (who: string) =>
  new ApiError("ALREADY_CLAIMED", `${who} already on this shift.`, 409);

const notClaimed = (who: string) =>
  new ApiError("NOT_CLAIMED", `${who} not on this shift.`, 409);

const raceLost = () =>
  new ApiError(
    "SHIFT_CHANGED",
    "This shift changed while you were claiming it. Please try again.",
    409,
  );

/* -------------------------------------------------------------------------- */
/* Claim                                                                       */
/* -------------------------------------------------------------------------- */

export async function claimShift(ctx: ClaimContext): Promise<ShiftDoc> {
  const client = await getClient();
  const db = await getDb();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      return claimWithinTransaction(db, session, ctx);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Exported so shift editing can re-validate an existing claim inside its own
 * transaction without opening a nested one.
 */
export async function claimWithinTransaction(
  db: Db,
  session: ClientSession,
  { shiftId, targetUser, actorId }: ClaimContext,
): Promise<ShiftDoc> {
  const shifts = db.collection<ShiftDoc>(COLLECTIONS.shifts);
  const users = db.collection<UserDoc>(COLLECTIONS.users);

  const shift = await shifts.findOne({ _id: shiftId }, { session });
  if (!shift) throw notFound("That shift");

  const profession = targetUser.profession;
  if (!profession) {
    throw new ApiError(
      "WRONG_PROFESSION",
      `${targetUser.name} has no clinical profession and cannot be assigned to shifts.`,
      409,
    );
  }

  const isSelf = targetUser._id.equals(actorId);
  const who = isSelf ? "You are" : `${targetUser.name} is`;

  /*
   * Diagnostic reads. These do NOT enforce anything -- the guarded updates below
   * do that. Their only job is to produce a specific message in the ordinary,
   * uncontended case, so the user is told *which* rule they hit rather than a
   * generic failure.
   */
  if (shift.requirements[profession] === 0) throw wrongProfession(profession);

  if (shift.claims.some((c) => c.userId.equals(targetUser._id))) {
    throw alreadyClaimed(who);
  }

  if (shift.filled[profession] >= shift.requirements[profession]) {
    throw shiftFull(profession, shift.requirements[profession]);
  }

  // Read the target's bookings inside the transaction so the conflicting shift
  // named in the error message is the one that actually blocks the claim.
  const fresh = await users.findOne({ _id: targetUser._id }, { session });
  if (!fresh) throw notFound("That staff member");

  const conflict = fresh.bookings.find((b) =>
    intervalsOverlap(b.startAt, b.endAt, shift.startAt, shift.endAt),
  );
  if (conflict) throw overlapping(conflict);

  /* ---- Enforcement. Everything above was advisory. ---------------------- */

  // 1. Reserve the time on the person.
  //
  //    This write is not bookkeeping -- it is the overlap rule's concurrency
  //    control. Touching this one array is what makes two concurrent overlapping
  //    claims by the same person collide; without it they would write disjoint
  //    shift documents and both succeed. The predicate rejects the write outright
  //    if any existing booking overlaps.
  const reserved = await users.updateOne(
    {
      _id: targetUser._id,
      bookings: {
        $not: {
          $elemMatch: {
            startAt: { $lt: shift.endAt },
            endAt: { $gt: shift.startAt },
          },
        },
      },
    },
    {
      $push: {
        bookings: {
          shiftId: shift._id,
          startAt: shift.startAt,
          endAt: shift.endAt,
        },
      },
    },
    { session },
  );

  if (reserved.matchedCount === 0) {
    // Lost a race against another claim for this same person.
    const now = await users.findOne({ _id: targetUser._id }, { session });
    const other = now?.bookings.find((b) =>
      intervalsOverlap(b.startAt, b.endAt, shift.startAt, shift.endAt),
    );
    throw other ? overlapping(other) : raceLost();
  }

  // 2. Take the slot on the shift. `$expr` compares two fields of the same
  //    document, so capacity is evaluated server-side at write time. The
  //    startAt/endAt equality guards catch a shift that was rescheduled between
  //    the read above and this write.
  const taken = await shifts.updateOne(
    {
      _id: shift._id,
      startAt: shift.startAt,
      endAt: shift.endAt,
      "claims.userId": { $ne: targetUser._id },
      $expr: {
        $lt: [`$filled.${profession}`, `$requirements.${profession}`],
      },
    },
    {
      $push: {
        claims: {
          userId: targetUser._id,
          name: targetUser.name,
          profession,
          claimedAt: new Date(),
          assignedBy: isSelf ? null : actorId,
        },
      },
      $inc: { [`filled.${profession}`]: 1 },
      $currentDate: { updatedAt: true },
    },
    { session },
  );

  if (taken.matchedCount === 0) {
    // Throwing here aborts the transaction, so the booking pushed in step 1 is
    // rolled back -- the person is not left holding a reservation for a shift
    // they never got.
    const now = await shifts.findOne({ _id: shift._id }, { session });
    if (!now) throw notFound("That shift");
    if (
      now.startAt.getTime() !== shift.startAt.getTime() ||
      now.endAt.getTime() !== shift.endAt.getTime()
    ) {
      throw raceLost();
    }
    if (now.claims.some((c) => c.userId.equals(targetUser._id))) {
      throw alreadyClaimed(who);
    }
    throw shiftFull(profession, now.requirements[profession]);
  }

  const updated = await shifts.findOne({ _id: shift._id }, { session });
  if (!updated) throw notFound("That shift");
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Release                                                                     */
/* -------------------------------------------------------------------------- */

export async function releaseShift(ctx: ClaimContext): Promise<ShiftDoc> {
  const client = await getClient();
  const db = await getDb();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      return releaseWithinTransaction(db, session, ctx);
    });
  } finally {
    await session.endSession();
  }
}

export async function releaseWithinTransaction(
  db: Db,
  session: ClientSession,
  { shiftId, targetUser, actorId }: ClaimContext,
): Promise<ShiftDoc> {
  const shifts = db.collection<ShiftDoc>(COLLECTIONS.shifts);
  const users = db.collection<UserDoc>(COLLECTIONS.users);

  const shift = await shifts.findOne({ _id: shiftId }, { session });
  if (!shift) throw notFound("That shift");

  const claim = shift.claims.find((c) => c.userId.equals(targetUser._id));
  if (!claim) {
    throw notClaimed(targetUser._id.equals(actorId) ? "You are" : `${targetUser.name} is`);
  }

  // Decrement the profession recorded on the claim rather than the user's current
  // profession, so the counter stays balanced even if their profession changed
  // after they claimed.
  const released = await shifts.updateOne(
    { _id: shift._id, "claims.userId": targetUser._id },
    {
      $pull: { claims: { userId: targetUser._id } },
      $inc: { [`filled.${claim.profession}`]: -1 },
      $currentDate: { updatedAt: true },
    },
    { session },
  );

  if (released.matchedCount === 0) throw notClaimed("That person is");

  await users.updateOne(
    { _id: targetUser._id },
    { $pull: { bookings: { shiftId: shift._id } } },
    { session },
  );

  const updated = await shifts.findOne({ _id: shift._id }, { session });
  if (!updated) throw notFound("That shift");
  return updated;
}
