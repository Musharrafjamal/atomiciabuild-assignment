import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type ShiftDoc } from "@/lib/db/schema";
import { clinicDayKey, weekBounds } from "@/lib/time";

/**
 * One query per week.
 *
 * Claims are embedded on the shift, so a whole week of the coverage dashboard --
 * every shift, every claimant's name, every fill count -- comes back in a single
 * indexed range scan with no join and no N+1. That matters on Atlas M0, which
 * throttles at 100 operations per second.
 */
export async function findShiftsForWeek(isoDate: string): Promise<ShiftDoc[]> {
  const { start, end } = weekBounds(isoDate);
  const db = await getDb();
  return db
    .collection<ShiftDoc>(COLLECTIONS.shifts)
    .find({ startAt: { $gte: start, $lt: end } })
    .sort({ startAt: 1 })
    .toArray();
}

/**
 * The clinic-local day of the shift nearest to a given week, in either direction.
 *
 * Landing on an empty week is a dead end -- the screen is blank and gives no clue
 * whether the rota is empty or you are simply looking at the wrong fortnight. The
 * empty state uses this to offer a single click to where the shifts actually are.
 */
export async function findNearestWeekWithShifts(
  isoDate: string,
): Promise<string | null> {
  const { start, end } = weekBounds(isoDate);
  const shifts = await (await getDb()).collection<ShiftDoc>(COLLECTIONS.shifts);

  const [next, previous] = await Promise.all([
    shifts.find({ startAt: { $gte: end } }).sort({ startAt: 1 }).limit(1).toArray(),
    shifts.find({ startAt: { $lt: start } }).sort({ startAt: -1 }).limit(1).toArray(),
  ]);

  const candidates = [next[0], previous[0]].filter(Boolean);
  if (candidates.length === 0) return null;

  const target = start.getTime();
  const closest = candidates.reduce((best, shift) =>
    Math.abs(shift.startAt.getTime() - target) <
    Math.abs(best.startAt.getTime() - target)
      ? shift
      : best,
  );

  return clinicDayKey(closest.startAt);
}
