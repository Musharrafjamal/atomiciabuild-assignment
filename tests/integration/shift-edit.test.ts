import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeClient } from "@/lib/db/client";
import { claimShift } from "@/lib/rules/claim";
import {
  applyShiftEdit,
  createShift,
  deleteShift,
  previewShiftEdit,
} from "@/lib/rules/shifts";
import {
  makeShift,
  makeUser,
  makeUsers,
  readShift,
  readUser,
  resetDatabase,
} from "../helpers/factories";
import { clinicTimeLabel } from "@/lib/time";

beforeEach(resetDatabase);
afterAll(closeClient);

const asInput = (over: Partial<Parameters<typeof createShift>[0]> = {}) => ({
  date: "2026-08-17",
  startTime: "08:00",
  endTime: "16:00",
  requirements: { nurse: 2 },
  ...over,
});

describe("createShift", () => {
  it("creates a valid shift", async () => {
    const shift = await createShift(asInput());
    expect(clinicTimeLabel(shift.startAt)).toBe("08:00");
    expect(clinicTimeLabel(shift.endAt)).toBe("16:00");
    expect(shift.requirements).toEqual({ nurse: 2, doctor: 0, receptionist: 0 });
    expect(shift.filled).toEqual({ nurse: 0, doctor: 0, receptionist: 0 });
  });

  it("supports an overnight shift", async () => {
    const shift = await createShift(
      asInput({ startTime: "22:00", endTime: "06:00" }),
    );
    expect(clinicTimeLabel(shift.startAt)).toBe("22:00");
    expect(clinicTimeLabel(shift.endAt)).toBe("06:00");
    expect(shift.endAt.getTime() - shift.startAt.getTime()).toBe(8 * 3600_000);
  });

  it("applies the same validation the CSV importer uses", async () => {
    // A manager must not be able to type in a shift the importer would reject.
    await expect(
      createShift(asInput({ startTime: "12:00", endTime: "12:00" })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      createShift(asInput({ startTime: "15:00", endTime: "09:00" })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      createShift(asInput({ startTime: "25:00" })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(createShift(asInput({ date: "17/08/2026" }))).rejects.toMatchObject(
      { code: "INVALID_INPUT" },
    );
  });

  it("refuses a shift that requires nobody", async () => {
    await expect(
      createShift(asInput({ requirements: { nurse: 0 } })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("deleteShift", () => {
  it("releases the claimants' bookings so they are not left blocked", async () => {
    const shift = await makeShift({ requirements: { nurse: 2 } });
    const [a, b] = await makeUsers("nurse", 2);
    await claimShift({ shiftId: shift._id, targetUser: a, actorId: a._id });
    await claimShift({ shiftId: shift._id, targetUser: b, actorId: b._id });

    await deleteShift(shift._id);

    expect((await readUser(a._id)).bookings).toHaveLength(0);
    expect((await readUser(b._id)).bookings).toHaveLength(0);

    // And they can now claim a shift at the same time as the deleted one.
    const replacement = await makeShift({ requirements: { nurse: 1 } });
    await claimShift({ shiftId: replacement._id, targetUser: a, actorId: a._id });
    expect((await readShift(replacement._id)).filled.nurse).toBe(1);
  });
});

describe("editing a shift that already has claims", () => {
  it("reports no conflicts when the edit affects nobody", async () => {
    const shift = await makeShift({ requirements: { nurse: 2 } });
    const nurse = await makeUser("nurse");
    await claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id });

    const preview = await previewShiftEdit(shift._id, asInput({ startTime: "09:00", endTime: "17:00" }));
    expect(preview.conflicts).toEqual([]);
  });

  it("names who would be released when requirements are lowered", async () => {
    const shift = await makeShift({ requirements: { nurse: 3 } });
    const nurses = await makeUsers("nurse", 3);
    for (const n of nurses) {
      await claimShift({ shiftId: shift._id, targetUser: n, actorId: n._id });
    }

    const preview = await previewShiftEdit(
      shift._id,
      asInput({ requirements: { nurse: 1 } }),
    );

    expect(preview.conflicts).toHaveLength(2);
    expect(preview.conflicts.every((c) => c.reason === "capacity")).toBe(true);
    expect(preview.conflicts[0].detail).toContain("now needs only 1 nurse");
  });

  it("releases the most recent claimants first, keeping the earliest", async () => {
    const shift = await makeShift({ requirements: { nurse: 3 } });
    const nurses = await makeUsers("nurse", 3);
    for (const n of nurses) {
      await claimShift({ shiftId: shift._id, targetUser: n, actorId: n._id });
      // Guarantee distinct claimedAt ordering.
      await new Promise((r) => setTimeout(r, 5));
    }

    const { released } = await applyShiftEdit(
      shift._id,
      asInput({ requirements: { nurse: 1 } }),
      undefined,
    );

    expect(released).toHaveLength(2);
    const keptIds = (await readShift(shift._id)).claims.map((c) =>
      c.userId.toHexString(),
    );
    expect(keptIds).toEqual([nurses[0]._id.toHexString()]);
  });

  it("re-validates overlap when the shift time moves", async () => {
    // A nurse holds two non-overlapping shifts; moving one onto the other must
    // release the claim rather than leave them double-booked.
    const early = await makeShift({ start: "08:00", end: "16:00", requirements: { nurse: 1 } });
    const late = await makeShift({ start: "16:00", end: "00:00", requirements: { nurse: 1 } });
    const nurse = await makeUser("nurse");

    await claimShift({ shiftId: early._id, targetUser: nurse, actorId: nurse._id });
    await claimShift({ shiftId: late._id, targetUser: nurse, actorId: nurse._id });
    expect((await readUser(nurse._id)).bookings).toHaveLength(2);

    const preview = await previewShiftEdit(
      late._id,
      asInput({ startTime: "14:00", endTime: "22:00", requirements: { nurse: 1 } }),
    );
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0].reason).toBe("overlap");
    expect(preview.conflicts[0].detail).toContain("08:00-16:00");

    const { released } = await applyShiftEdit(
      late._id,
      asInput({ startTime: "14:00", endTime: "22:00", requirements: { nurse: 1 } }),
      preview.expectedUpdatedAt,
    );

    expect(released).toHaveLength(1);
    expect((await readShift(late._id)).claims).toHaveLength(0);
    expect((await readShift(late._id)).filled.nurse).toBe(0);
    expect((await readUser(nurse._id)).bookings).toHaveLength(1);
  });

  /**
   * The failure that would otherwise be invisible. If a surviving claimant's
   * denormalised booking is not moved with the shift, the overlap rule keeps using
   * the shift's OLD hours forever -- so the nurse could be booked onto something
   * that really does clash.
   */
  it("moves surviving claimants' bookings to the new times", async () => {
    const shift = await makeShift({ start: "08:00", end: "16:00", requirements: { nurse: 1 } });
    const nurse = await makeUser("nurse");
    await claimShift({ shiftId: shift._id, targetUser: nurse, actorId: nurse._id });

    await applyShiftEdit(
      shift._id,
      asInput({ startTime: "18:00", endTime: "22:00", requirements: { nurse: 1 } }),
      undefined,
    );

    const booking = (await readUser(nurse._id)).bookings[0];
    expect(clinicTimeLabel(booking.startAt)).toBe("18:00");
    expect(clinicTimeLabel(booking.endAt)).toBe("22:00");

    // Proof it is actually used: a shift in the vacated morning slot is now
    // claimable, and one clashing with the new evening slot is not.
    const morning = await makeShift({ start: "08:00", end: "16:00", requirements: { nurse: 1 } });
    await claimShift({ shiftId: morning._id, targetUser: nurse, actorId: nurse._id });
    expect((await readShift(morning._id)).filled.nurse).toBe(1);

    const evening = await makeShift({ start: "20:00", end: "23:00", requirements: { nurse: 1 } });
    await expect(
      claimShift({ shiftId: evening._id, targetUser: nurse, actorId: nurse._id }),
    ).rejects.toMatchObject({ code: "OVERLAPPING_CLAIM" });
  });

  it("refuses to apply a preview that has gone stale", async () => {
    const shift = await makeShift({ requirements: { nurse: 2 } });
    const [a, b] = await makeUsers("nurse", 2);
    await claimShift({ shiftId: shift._id, targetUser: a, actorId: a._id });

    const preview = await previewShiftEdit(
      shift._id,
      asInput({ requirements: { nurse: 1 } }),
    );
    expect(preview.conflicts).toHaveLength(0);

    // Someone else claims before the manager confirms.
    await claimShift({ shiftId: shift._id, targetUser: b, actorId: b._id });

    await expect(
      applyShiftEdit(
        shift._id,
        asInput({ requirements: { nurse: 1 } }),
        preview.expectedUpdatedAt,
      ),
    ).rejects.toMatchObject({ code: "SHIFT_CHANGED" });

    // Nothing was applied.
    const after = await readShift(shift._id);
    expect(after.claims).toHaveLength(2);
    expect(after.requirements.nurse).toBe(2);
  });

  it("keeps filled counts consistent with the surviving claims", async () => {
    const shift = await makeShift({ requirements: { nurse: 3, doctor: 2 } });
    const nurses = await makeUsers("nurse", 3);
    const doctors = await makeUsers("doctor", 2);
    for (const u of [...nurses, ...doctors]) {
      await claimShift({ shiftId: shift._id, targetUser: u, actorId: u._id });
    }

    await applyShiftEdit(
      shift._id,
      asInput({ requirements: { nurse: 1, doctor: 2 } }),
      undefined,
    );

    const after = await readShift(shift._id);
    expect(after.filled.nurse).toBe(1);
    expect(after.filled.doctor).toBe(2);
    expect(after.claims.filter((c) => c.profession === "nurse")).toHaveLength(1);
    expect(after.claims.filter((c) => c.profession === "doctor")).toHaveLength(2);
    expect(after.claims).toHaveLength(after.filled.nurse + after.filled.doctor);
  });

  it("applies the importer's time validation to edits too", async () => {
    const shift = await makeShift({ requirements: { nurse: 1 } });
    await expect(
      applyShiftEdit(
        shift._id,
        asInput({ startTime: "12:00", endTime: "12:00" }),
        undefined,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
