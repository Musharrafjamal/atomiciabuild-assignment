import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type ShiftDoc } from "@/lib/db/schema";
import { weekBounds } from "@/lib/time";

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
