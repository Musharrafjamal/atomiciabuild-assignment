import { ObjectId } from "mongodb";
import { getClient, getDb } from "@/lib/db/client";
import {
  COLLECTIONS,
  PROFESSIONS,
  ZERO_COUNT,
  type ShiftDoc,
  type ShiftSeriesDoc,
  type StaffCount,
  type UserDoc,
} from "@/lib/db/schema";
import { invalidInput, notFound } from "@/lib/errors";
import { buildShiftInterval, parseTime } from "@/lib/import/datetime";
import { clinicWeekday, eachClinicDay } from "@/lib/time";

/**
 * Recurring shifts: "every Mon/Wed 08:00-16:00 until 30 September".
 *
 * Occurrences are **materialised** as ordinary shift documents carrying a
 * `seriesId`, not computed on read. Three reasons:
 *
 *  1. A claim has to attach to something. Claims live on a shift document, so an
 *     occurrence must be one -- otherwise claiming a recurring shift would need
 *     an entirely separate code path from claiming a one-off, which is exactly
 *     the kind of divergence the rest of this codebase avoids.
 *  2. The coverage dashboard stays one indexed range query per week. A computed
 *     series would have to be expanded on every read.
 *  3. Editing one occurrence is then just editing a shift.
 *
 * The cost is that changing a series has to reconcile the generated documents,
 * which is what `regenerate` does.
 */

const MAX_OCCURRENCES = 400;

export interface SeriesInput {
  weekdays: number[];
  startTime: string;
  endTime: string;
  fromDate: string;
  untilDate: string;
  requirements: Partial<StaffCount>;
}

interface Resolved {
  weekdays: number[];
  startTime: string;
  endTime: string;
  fromDate: string;
  untilDate: string;
  requirements: StaffCount;
  crossesMidnight: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function resolve(input: SeriesInput): Resolved {
  if (!ISO.test(input.fromDate) || !ISO.test(input.untilDate)) {
    throw invalidInput("Dates must be in YYYY-MM-DD format.");
  }
  if (input.untilDate < input.fromDate) {
    throw invalidInput("The end date must not be before the start date.");
  }

  const weekdays = [...new Set(input.weekdays)].sort();
  if (weekdays.length === 0) {
    throw invalidInput("Choose at least one day of the week.");
  }
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw invalidInput("Days of the week must be between 0 (Sunday) and 6.");
  }

  // Same validation the CSV importer applies, so a recurring shift cannot be
  // something a one-off shift is not allowed to be.
  const start = parseTime(input.startTime, "start time");
  if (!start.ok) throw invalidInput(start.reason);
  const end = parseTime(input.endTime, "end time");
  if (!end.ok) throw invalidInput(end.reason);

  const probe = buildShiftInterval(input.fromDate, start.value, end.value);
  if (!probe.ok) throw invalidInput(probe.reason);

  const requirements: StaffCount = { ...ZERO_COUNT, ...input.requirements };
  if (PROFESSIONS.every((p) => requirements[p] === 0)) {
    throw invalidInput("A shift must require at least one member of staff.");
  }

  return {
    weekdays,
    startTime: input.startTime,
    endTime: input.endTime,
    fromDate: input.fromDate,
    untilDate: input.untilDate,
    requirements,
    crossesMidnight: probe.value.crossesMidnight,
  };
}

/** The clinic-local dates a series should occur on, minus its exceptions. */
export function occurrenceDates(
  series: Pick<Resolved, "weekdays" | "fromDate" | "untilDate">,
  exceptions: string[] = [],
): string[] {
  const skip = new Set(exceptions);
  return eachClinicDay(series.fromDate, series.untilDate)
    .filter((day) => series.weekdays.includes(clinicWeekday(day)))
    .filter((day) => !skip.has(day));
}

function shiftFor(
  series: ShiftSeriesDoc,
  day: string,
  now: Date,
): ShiftDoc {
  const start = parseTime(series.startTime, "start time");
  const end = parseTime(series.endTime, "end time");
  if (!start.ok || !end.ok) throw invalidInput("Series has invalid times.");

  const interval = buildShiftInterval(day, start.value, end.value);
  if (!interval.ok) throw invalidInput(interval.reason);

  return {
    _id: new ObjectId(),
    externalId: null,
    startAt: interval.value.startAt,
    endAt: interval.value.endAt,
    requirements: series.requirements,
    filled: { ...ZERO_COUNT },
    claims: [],
    seriesId: series._id,
    occurrenceDate: day,
    detachedFromSeries: false,
    createdAt: now,
    updatedAt: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export async function createSeries(
  input: SeriesInput,
): Promise<{ series: ShiftSeriesDoc; created: number }> {
  const resolved = resolve(input);
  const days = occurrenceDates(resolved);

  if (days.length === 0) {
    throw invalidInput(
      "That combination of days and dates produces no shifts at all.",
    );
  }
  if (days.length > MAX_OCCURRENCES) {
    throw invalidInput(
      `That would create ${days.length} shifts. Shorten the date range (limit is ${MAX_OCCURRENCES}).`,
    );
  }

  const db = await getDb();
  const now = new Date();

  const series: ShiftSeriesDoc = {
    _id: new ObjectId(),
    weekdays: resolved.weekdays,
    startTime: resolved.startTime,
    endTime: resolved.endTime,
    crossesMidnight: resolved.crossesMidnight,
    requirements: resolved.requirements,
    fromDate: resolved.fromDate,
    untilDate: resolved.untilDate,
    exceptions: [],
    createdAt: now,
    updatedAt: now,
  };

  await db
    .collection<ShiftSeriesDoc>(COLLECTIONS.shiftSeries)
    .insertOne(series);

  const shifts = days.map((day) => shiftFor(series, day, now));
  await db.collection<ShiftDoc>(COLLECTIONS.shifts).insertMany(shifts);

  return { series, created: shifts.length };
}

/* -------------------------------------------------------------------------- */
/* Single-occurrence operations                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mark one occurrence as edited individually.
 *
 * Once detached, a later change to the series leaves this shift alone -- which is
 * what "edit a single occurrence without breaking the series" means. The shift
 * keeps its `seriesId` so it can still be shown as part of the series, and so
 * deleting the series still cleans it up.
 */
export async function detachOccurrence(shiftId: ObjectId): Promise<void> {
  const db = await getDb();
  await db
    .collection<ShiftDoc>(COLLECTIONS.shifts)
    .updateOne(
      { _id: shiftId, seriesId: { $ne: null } },
      { $set: { detachedFromSeries: true } },
    );
}

/**
 * Record that one occurrence was deleted, so regeneration does not resurrect it.
 * Called alongside the ordinary shift deletion, which handles releasing claims.
 */
export async function excludeOccurrence(shift: ShiftDoc): Promise<void> {
  if (!shift.seriesId || !shift.occurrenceDate) return;
  const db = await getDb();
  await db
    .collection<ShiftSeriesDoc>(COLLECTIONS.shiftSeries)
    .updateOne(
      { _id: shift.seriesId },
      {
        $addToSet: { exceptions: shift.occurrenceDate },
        $currentDate: { updatedAt: true },
      },
    );
}

/* -------------------------------------------------------------------------- */
/* Update / delete the whole series                                            */
/* -------------------------------------------------------------------------- */

export interface RegenerateResult {
  added: number;
  removed: number;
  updated: number;
  skippedDetached: number;
  skippedClaimed: number;
}

/**
 * Reconcile a series' generated shifts after its definition changes.
 *
 * Three categories are deliberately left alone:
 *
 *  - **Detached occurrences**, which have been edited individually.
 *  - **Occurrences with claims** that are no longer wanted. Silently deleting a
 *    shift somebody is rostered on is precisely the behaviour rejected for
 *    single-shift edits in DECISIONS.md §5, so they are reported instead and the
 *    manager can remove them deliberately.
 *  - **Past occurrences**, which are a record of what happened.
 */
export async function updateSeries(
  seriesId: ObjectId,
  input: SeriesInput,
  today: string,
): Promise<{ series: ShiftSeriesDoc; result: RegenerateResult }> {
  const resolved = resolve(input);
  const client = await getClient();
  const db = await getDb();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const seriesCol = db.collection<ShiftSeriesDoc>(COLLECTIONS.shiftSeries);
      const shiftsCol = db.collection<ShiftDoc>(COLLECTIONS.shifts);

      const existing = await seriesCol.findOne({ _id: seriesId }, { session });
      if (!existing) throw notFound("That shift series");

      const now = new Date();
      const updatedSeries: ShiftSeriesDoc = {
        ...existing,
        ...resolved,
        exceptions: existing.exceptions,
        updatedAt: now,
      };

      await seriesCol.updateOne(
        { _id: seriesId },
        {
          $set: {
            weekdays: resolved.weekdays,
            startTime: resolved.startTime,
            endTime: resolved.endTime,
            crossesMidnight: resolved.crossesMidnight,
            requirements: resolved.requirements,
            fromDate: resolved.fromDate,
            untilDate: resolved.untilDate,
            updatedAt: now,
          },
        },
        { session },
      );

      const current = await shiftsCol
        .find({ seriesId }, { session })
        .toArray();

      const wanted = new Set(
        occurrenceDates(resolved, existing.exceptions).filter((d) => d >= today),
      );

      const result: RegenerateResult = {
        added: 0,
        removed: 0,
        updated: 0,
        skippedDetached: 0,
        skippedClaimed: 0,
      };

      const toDelete: ObjectId[] = [];

      for (const shift of current) {
        const day = shift.occurrenceDate;
        if (!day || day < today) continue; // the past is a record, not a plan

        if (shift.detachedFromSeries) {
          result.skippedDetached += 1;
          wanted.delete(day); // it already covers this date
          continue;
        }

        if (wanted.has(day)) {
          const fresh = shiftFor(updatedSeries, day, now);
          await shiftsCol.updateOne(
            { _id: shift._id },
            {
              $set: {
                startAt: fresh.startAt,
                endAt: fresh.endAt,
                requirements: resolved.requirements,
                updatedAt: now,
              },
            },
            { session },
          );
          // Move the claimants' denormalised bookings with the shift, for the
          // same reason single-shift edits do. See DECISIONS.md §5.
          if (shift.claims.length > 0) {
            await db.collection<UserDoc>(COLLECTIONS.users).updateMany(
              {
                _id: { $in: shift.claims.map((c) => c.userId) },
                "bookings.shiftId": shift._id,
              },
              {
                $set: {
                  "bookings.$[entry].startAt": fresh.startAt,
                  "bookings.$[entry].endAt": fresh.endAt,
                },
              },
              { session, arrayFilters: [{ "entry.shiftId": shift._id }] },
            );
          }
          result.updated += 1;
          wanted.delete(day);
          continue;
        }

        // No longer wanted.
        if (shift.claims.length > 0) {
          result.skippedClaimed += 1;
          continue;
        }
        toDelete.push(shift._id);
      }

      if (toDelete.length) {
        await shiftsCol.deleteMany({ _id: { $in: toDelete } }, { session });
        result.removed = toDelete.length;
      }

      const additions = [...wanted].map((day) =>
        shiftFor(updatedSeries, day, now),
      );
      if (additions.length) {
        await shiftsCol.insertMany(additions, { session });
        result.added = additions.length;
      }

      return { series: updatedSeries, result };
    });
  } finally {
    await session.endSession();
  }
}

/** Delete a series and every future occurrence that has not been detached. */
export async function deleteSeries(
  seriesId: ObjectId,
  today: string,
): Promise<{ removed: number; keptClaimed: number }> {
  const client = await getClient();
  const db = await getDb();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const shiftsCol = db.collection<ShiftDoc>(COLLECTIONS.shifts);
      const shifts = await shiftsCol.find({ seriesId }, { session }).toArray();

      const removable = shifts.filter(
        (s) =>
          (s.occurrenceDate ?? "") >= today &&
          !s.detachedFromSeries &&
          s.claims.length === 0,
      );

      if (removable.length) {
        await shiftsCol.deleteMany(
          { _id: { $in: removable.map((s) => s._id) } },
          { session },
        );
      }

      // Anything kept loses its link, so it survives as an ordinary one-off.
      await shiftsCol.updateMany(
        { seriesId },
        { $set: { seriesId: null, occurrenceDate: null } },
        { session },
      );

      await db
        .collection<ShiftSeriesDoc>(COLLECTIONS.shiftSeries)
        .deleteOne({ _id: seriesId }, { session });

      return {
        removed: removable.length,
        keptClaimed: shifts.filter(
          (s) => (s.occurrenceDate ?? "") >= today && s.claims.length > 0,
        ).length,
      };
    });
  } finally {
    await session.endSession();
  }
}
