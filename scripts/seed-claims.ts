import type { Db } from "mongodb";
import { COLLECTIONS, PROFESSIONS, type ShiftDoc, type UserDoc } from "@/lib/db/schema";
import { claimShift } from "@/lib/rules/claim";

/**
 * Puts some people on some shifts so the seeded database shows a realistic mix
 * of coverage.
 *
 * Without this every shift is empty, so the coverage dashboard can only ever
 * render one of the three states it exists to distinguish -- a reviewer would
 * never see "fully staffed" or "short" at all.
 *
 * Two properties matter here:
 *
 *  - It goes through the real `claimShift`, not direct inserts. The filled
 *    counters, the denormalised bookings and the overlap rule are therefore all
 *    consistent by construction, and the seeded state is one the application
 *    could actually have reached.
 *  - It is deterministic. No randomness, so the same CSVs always produce the
 *    same rota and the README's description of the data stays true.
 */

/** Cycle: fully staff, half staff, leave empty, half staff. */
const PATTERN = ["full", "half", "none", "half"] as const;

export async function seedClaims(db: Db): Promise<{ claims: number }> {
  const shifts = await db
    .collection<ShiftDoc>(COLLECTIONS.shifts)
    .find({})
    .sort({ startAt: 1 })
    .toArray();

  const staff = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .find({ role: "staff" })
    .sort({ _id: 1 })
    .toArray();

  const pool = new Map(
    PROFESSIONS.map((p) => [p, staff.filter((s) => s.profession === p)]),
  );
  // Rotating cursor per profession so the work spreads across the roster rather
  // than loading the first few people in the list.
  const cursor = new Map(PROFESSIONS.map((p) => [p, 0]));

  let claims = 0;

  for (const [index, shift] of shifts.entries()) {
    const mode = PATTERN[index % PATTERN.length];
    if (mode === "none") continue;

    for (const profession of PROFESSIONS) {
      const required = shift.requirements[profession];
      if (required === 0) continue;

      const wanted = mode === "full" ? required : Math.floor(required / 2);
      const candidates = pool.get(profession) ?? [];
      if (wanted === 0 || candidates.length === 0) continue;

      let placed = 0;
      // Bounded by the roster size: a candidate who is already booked at this
      // time is skipped, not retried.
      for (let tried = 0; tried < candidates.length && placed < wanted; tried++) {
        const at = (cursor.get(profession)! + tried) % candidates.length;
        const person = candidates[at];

        try {
          await claimShift({
            shiftId: shift._id,
            targetUser: person,
            actorId: person._id,
          });
          placed += 1;
          claims += 1;
          cursor.set(profession, (at + 1) % candidates.length);
        } catch {
          // Overlaps and full shifts are expected while filling a dense rota;
          // the next candidate gets a turn.
        }
      }
    }
  }

  return { claims };
}
