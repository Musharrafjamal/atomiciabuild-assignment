import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeClient } from "@/lib/db/client";
import { claimShift, releaseShift } from "@/lib/rules/claim";
import { ApiError } from "@/lib/errors";
import {
  makeShift,
  makeUser,
  makeUsers,
  raceAll,
  readShift,
  readUser,
  resetDatabase,
} from "../helpers/factories";

/**
 * ============================================================================
 * The tests the brief is really asking for.
 * ============================================================================
 *
 * "Note that several staff members may be using the website at the same time, so
 * a shift's availability should stay accurate no matter how many people are
 * acting on it at once."
 *
 * A read-then-write implementation passes every sequential test and fails these.
 * They run against a real replica set, not a mock, because the guarantee being
 * tested is the database's.
 */

const codesOf = (rejected: unknown[]) =>
  rejected.map((r) => (r instanceof ApiError ? r.code : `UNEXPECTED: ${r}`));

beforeEach(resetDatabase);
afterAll(closeClient);

describe("capacity under concurrent claims", () => {
  it("gives the single nurse slot to exactly one of eight simultaneous claimants", async () => {
    const shift = await makeShift({ requirements: { nurse: 1 } });
    const nurses = await makeUsers("nurse", 8);

    const { fulfilled, rejected } = await raceAll(nurses, (nurse) =>
      claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(new Set(codesOf(rejected))).toEqual(new Set(["SHIFT_FULL"]));

    const after = await readShift(shift._id);
    expect(after.filled.nurse).toBe(1);
    expect(after.claims).toHaveLength(1);
  });

  it("never exceeds capacity when the slots and the claimants are both plentiful", async () => {
    // 3 slots, 12 simultaneous claimants. The counter and the claim array must
    // agree, and neither may exceed the requirement.
    const shift = await makeShift({ requirements: { nurse: 3 } });
    const nurses = await makeUsers("nurse", 12);

    const { fulfilled, rejected } = await raceAll(nurses, (nurse) =>
      claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id }),
    );

    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(9);

    const after = await readShift(shift._id);
    expect(after.filled.nurse).toBe(3);
    expect(after.claims).toHaveLength(3);
    expect(new Set(after.claims.map((c) => c.userId.toHexString())).size).toBe(3);
  });

  it("keeps each profession's capacity independent", async () => {
    const shift = await makeShift({
      requirements: { nurse: 2, doctor: 1, receptionist: 0 },
    });
    const nurses = await makeUsers("nurse", 5);
    const doctors = await makeUsers("doctor", 5);
    const receptionists = await makeUsers("receptionist", 3);

    const everyone = [...nurses, ...doctors, ...receptionists];
    const { fulfilled } = await raceAll(everyone, (u) =>
      claimShift({ shiftId: shift._id, targetUser: u, actorId: u._id }),
    );

    expect(fulfilled).toHaveLength(3); // 2 nurses + 1 doctor, 0 receptionists

    const after = await readShift(shift._id);
    expect(after.filled).toEqual({ nurse: 2, doctor: 1, receptionist: 0 });
  });

  it("leaves the counter consistent when claims and releases interleave", async () => {
    const shift = await makeShift({ requirements: { nurse: 4 } });
    const nurses = await makeUsers("nurse", 4);

    // Everyone claims, then everyone releases and re-claims at the same time.
    await raceAll(nurses, (n) =>
      claimShift({ shiftId: shift._id, targetUser: n, actorId: n._id }),
    );
    expect((await readShift(shift._id)).filled.nurse).toBe(4);

    await raceAll(nurses, async (n) => {
      await releaseShift({ shiftId: shift._id, targetUser: n, actorId: n._id });
      return claimShift({ shiftId: shift._id, targetUser: n, actorId: n._id });
    });

    const after = await readShift(shift._id);
    expect(after.filled.nurse).toBe(4);
    expect(after.claims).toHaveLength(4);
  });
});

describe("overlap under concurrent claims (write skew)", () => {
  it("stops one person double-booking two overlapping shifts claimed simultaneously", async () => {
    /*
     * The case snapshot isolation alone does not prevent. Both transactions read
     * the nurse's (empty) bookings, find no conflict, and write to two *different*
     * shift documents -- so nothing collides unless the claim also writes to the
     * nurse's own document. That write is what makes one of these abort.
     *
     * Confirmed to have teeth: swapping the user-document write for a
     * shifts-collection overlap query makes this test fail with the nurse holding
     * both shifts.
     */
    const morning = await makeShift({ start: "08:00", end: "16:00" });
    const overlapping = await makeShift({ start: "14:00", end: "22:00" });
    const nurse = await makeUser("nurse");

    const { fulfilled, rejected } = await raceAll(
      [morning, overlapping],
      (shift) =>
        claimShift({
          shiftId: shift._id,
          targetUser: nurse,
          actorId: nurse._id,
        }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const after = await readUser(nurse._id);
    expect(after.bookings).toHaveLength(1);

    // Exactly one of the two shifts carries the claim -- the loser must have been
    // rolled back rather than left holding a half-written claim.
    const claimTotal =
      (await readShift(morning._id)).claims.length +
      (await readShift(overlapping._id)).claims.length;
    expect(claimTotal).toBe(1);
  });

  it("holds when one person fires many overlapping claims at once", async () => {
    const nurse = await makeUser("nurse");
    const shifts = await Promise.all([
      makeShift({ start: "08:00", end: "16:00" }),
      makeShift({ start: "09:00", end: "17:00" }),
      makeShift({ start: "10:00", end: "18:00" }),
      makeShift({ start: "11:00", end: "19:00" }),
      makeShift({ start: "12:00", end: "20:00" }),
    ]);

    const { fulfilled } = await raceAll(shifts, (shift) =>
      claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id }),
    );

    expect(fulfilled).toHaveLength(1);
    expect((await readUser(nurse._id)).bookings).toHaveLength(1);
  });

  it("allows genuinely non-overlapping shifts claimed at the same time", async () => {
    // Back-to-back and separate days must all succeed -- the guard must not be
    // so strict that it blocks legitimate rostering.
    const nurse = await makeUser("nurse");
    const shifts = await Promise.all([
      makeShift({ date: "2026-08-17", start: "08:00", end: "16:00" }),
      makeShift({ date: "2026-08-17", start: "16:00", end: "00:00" }), // back-to-back
      makeShift({ date: "2026-08-19", start: "08:00", end: "16:00" }),
    ]);

    const { fulfilled, rejected } = await raceAll(shifts, (shift) =>
      claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id }),
    );

    expect(codesOf(rejected)).toEqual([]);
    expect(fulfilled).toHaveLength(3);
    expect((await readUser(nurse._id)).bookings).toHaveLength(3);
  });
});

describe("sequential rule enforcement", () => {
  it("rejects an overlapping claim with the conflicting shift named", async () => {
    const nurse = await makeUser("nurse");
    const night = await makeShift({
      date: "2026-08-17",
      start: "22:00",
      end: "06:00",
      endsNextDay: true,
    });
    const morning = await makeShift({
      date: "2026-08-18",
      start: "05:00",
      end: "13:00",
    });

    await claimShift({ shiftId: night._id, targetUser: nurse, actorId: nurse._id });

    const error = await claimShift({
      shiftId: morning._id,
      targetUser: nurse,
      actorId: nurse._id,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("OVERLAPPING_CLAIM");
    expect(error.message).toContain("2026-08-17 22:00-06:00");
  });

  it("rejects a second claim on the same shift", async () => {
    const shift = await makeShift({ requirements: { nurse: 2 } });
    const nurse = await makeUser("nurse");

    await claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id });
    const error = await claimShift({
      shiftId: shift._id,
      targetUser: nurse,
      actorId: nurse._id,
    }).catch((e) => e);

    expect(error.code).toBe("ALREADY_CLAIMED");
    expect((await readShift(shift._id)).filled.nurse).toBe(1);
  });

  it("explains that a shift needs none of your profession", async () => {
    const shift = await makeShift({ requirements: { nurse: 2, doctor: 0 } });
    const doctor = await makeUser("doctor");

    const error = await claimShift({
      shiftId: shift._id,
      targetUser: doctor,
      actorId: doctor._id,
    }).catch((e) => e);

    expect(error.code).toBe("WRONG_PROFESSION");
    expect(error.message).toContain("does not need any doctors");
  });

  it("frees the slot and the booking on release", async () => {
    const shift = await makeShift({ requirements: { nurse: 1 } });
    const [a, b] = await makeUsers("nurse", 2);

    await claimShift({ shiftId: shift._id, targetUser: a, actorId: a._id });
    await expect(
      claimShift({ shiftId: shift._id, targetUser: b, actorId: b._id }),
    ).rejects.toMatchObject({ code: "SHIFT_FULL" });

    await releaseShift({ shiftId: shift._id, targetUser: a, actorId: a._id });

    expect((await readShift(shift._id)).filled.nurse).toBe(0);
    expect((await readUser(a._id)).bookings).toHaveLength(0);

    // The freed slot is now claimable by someone else.
    await claimShift({ shiftId: shift._id, targetUser: b, actorId: b._id });
    expect((await readShift(shift._id)).filled.nurse).toBe(1);
  });

  it("refuses to release a shift that was never claimed", async () => {
    const shift = await makeShift({ requirements: { nurse: 1 } });
    const nurse = await makeUser("nurse");

    await expect(
      releaseShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id }),
    ).rejects.toMatchObject({ code: "NOT_CLAIMED" });
  });

  it("rolls back the booking when the shift write fails", async () => {
    // Fill the shift, then race a claim that will pass the overlap guard but fail
    // the capacity guard. The booking pushed in step 1 must not survive.
    const shift = await makeShift({ requirements: { nurse: 1 } });
    const [a, b] = await makeUsers("nurse", 2);

    await claimShift({ shiftId: shift._id, targetUser: a, actorId: a._id });
    await expect(
      claimShift({ shiftId: shift._id, targetUser: b, actorId: b._id }),
    ).rejects.toMatchObject({ code: "SHIFT_FULL" });

    const loser = await readUser(b._id);
    expect(loser.bookings).toHaveLength(0);
  });
});

describe("manager assignment obeys the identical rules", () => {
  it("cannot assign someone past a profession's capacity", async () => {
    const manager = await makeUser(null);
    const shift = await makeShift({ requirements: { nurse: 1 } });
    const [a, b] = await makeUsers("nurse", 2);

    await claimShift({
      shiftId: shift._id,
      targetUser: a,
      actorId: manager._id,
    });

    await expect(
      claimShift({ shiftId: shift._id, targetUser: b, actorId: manager._id }),
    ).rejects.toMatchObject({ code: "SHIFT_FULL" });
  });

  it("cannot assign someone onto an overlapping shift", async () => {
    const manager = await makeUser(null);
    const nurse = await makeUser("nurse");
    const first = await makeShift({ start: "08:00", end: "16:00" });
    const second = await makeShift({ start: "12:00", end: "20:00" });

    await claimShift({
      shiftId: first._id,
      targetUser: nurse,
      actorId: manager._id,
    });

    await expect(
      claimShift({ shiftId: second._id, targetUser: nurse, actorId: manager._id }),
    ).rejects.toMatchObject({ code: "OVERLAPPING_CLAIM" });
  });

  it("records who assigned the shift", async () => {
    const manager = await makeUser(null);
    const nurse = await makeUser("nurse");
    const shift = await makeShift({ requirements: { nurse: 1 } });

    await claimShift({
      shiftId: shift._id,
      targetUser: nurse,
      actorId: manager._id,
    });

    const after = await readShift(shift._id);
    expect(after.claims[0].assignedBy?.toHexString()).toBe(
      manager._id.toHexString(),
    );

    // A self-claim records no assigner.
    const other = await makeShift({ requirements: { nurse: 1 }, date: "2026-08-20" });
    await claimShift({ shiftId: other._id, targetUser: nurse, actorId: nurse._id });
    expect((await readShift(other._id)).claims[0].assignedBy).toBeNull();
  });

  it("refuses to assign a manager, who has no profession", async () => {
    const manager = await makeUser(null);
    const shift = await makeShift({ requirements: { nurse: 1 } });

    await expect(
      claimShift({ shiftId: shift._id, targetUser: manager, actorId: manager._id }),
    ).rejects.toMatchObject({ code: "WRONG_PROFESSION" });
  });
});
