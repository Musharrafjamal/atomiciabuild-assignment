import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { closeClient, getDb } from "@/lib/db/client";
import { COLLECTIONS, type ShiftDoc, type ShiftSeriesDoc } from "@/lib/db/schema";
import {
  createSeries,
  deleteSeries,
  detachOccurrence,
  excludeOccurrence,
  occurrenceDates,
  updateSeries,
} from "@/lib/rules/series";
import { deleteShift } from "@/lib/rules/shifts";
import { claimShift } from "@/lib/rules/claim";
import { clinicDayKey, clinicTimeLabel } from "@/lib/time";
import { makeUser, readUser, resetDatabase } from "../helpers/factories";

beforeEach(resetDatabase);
afterAll(closeClient);

/** Everything here is well before the seeded roster, so nothing collides. */
const BASE = {
  weekdays: [1, 3], // Monday and Wednesday
  startTime: "08:00",
  endTime: "16:00",
  fromDate: "2026-09-07", // a Monday
  untilDate: "2026-09-30",
  requirements: { nurse: 2 },
};

async function seriesShifts(seriesId: ObjectId): Promise<ShiftDoc[]> {
  const db = await getDb();
  return db
    .collection<ShiftDoc>(COLLECTIONS.shifts)
    .find({ seriesId })
    .sort({ startAt: 1 })
    .toArray();
}

async function readSeries(id: ObjectId): Promise<ShiftSeriesDoc> {
  const db = await getDb();
  const found = await db
    .collection<ShiftSeriesDoc>(COLLECTIONS.shiftSeries)
    .findOne({ _id: id });
  if (!found) throw new Error("series disappeared");
  return found;
}

describe("occurrenceDates", () => {
  it("lists only the chosen weekdays in range", () => {
    const days = occurrenceDates(BASE);
    // Sept 2026: Mondays 7, 14, 21, 28; Wednesdays 9, 16, 23, 30
    expect(days).toEqual([
      "2026-09-07",
      "2026-09-09",
      "2026-09-14",
      "2026-09-16",
      "2026-09-21",
      "2026-09-23",
      "2026-09-28",
      "2026-09-30",
    ]);
  });

  it("omits exceptions", () => {
    expect(occurrenceDates(BASE, ["2026-09-14", "2026-09-30"])).not.toContain(
      "2026-09-14",
    );
    expect(occurrenceDates(BASE, ["2026-09-14"])).toHaveLength(7);
  });

  it("stays correct across the autumn DST change", () => {
    // UK clocks go back on Sunday 25 October 2026. Stepping in fixed 24h
    // increments rather than calendar days would drop or repeat a Monday.
    const days = occurrenceDates({
      weekdays: [1],
      fromDate: "2026-10-19",
      untilDate: "2026-11-09",
    });
    expect(days).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
  });
});

describe("createSeries", () => {
  it("materialises one shift per occurrence", async () => {
    const { series, created } = await createSeries(BASE);
    expect(created).toBe(8);

    const shifts = await seriesShifts(series._id);
    expect(shifts).toHaveLength(8);
    expect(shifts.every((s) => s.seriesId?.equals(series._id))).toBe(true);
    expect(shifts.every((s) => !s.detachedFromSeries)).toBe(true);
    expect(clinicTimeLabel(shifts[0].startAt)).toBe("08:00");
    expect(shifts[0].requirements.nurse).toBe(2);
  });

  it("supports an overnight recurring shift", async () => {
    const { series } = await createSeries({
      ...BASE,
      startTime: "22:00",
      endTime: "06:00",
    });
    const shifts = await seriesShifts(series._id);
    expect(shifts[0].endAt.getTime() - shifts[0].startAt.getTime()).toBe(
      8 * 3600_000,
    );
  });

  it("applies the same time validation as one-off shifts", async () => {
    await expect(
      createSeries({ ...BASE, startTime: "12:00", endTime: "12:00" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createSeries({ ...BASE, startTime: "15:00", endTime: "09:00" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a range that produces nothing", async () => {
    await expect(
      createSeries({
        ...BASE,
        weekdays: [0], // Sunday
        fromDate: "2026-09-07",
        untilDate: "2026-09-11", // Mon-Fri only
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("editing a single occurrence", () => {
  it("detaches it, and a later series change leaves it alone", async () => {
    const { series } = await createSeries(BASE);
    const shifts = await seriesShifts(series._id);
    const target = shifts[2]; // 2026-09-14

    await detachOccurrence(target._id);

    // Now move the whole series to 10:00-18:00.
    const { result } = await updateSeries(
      series._id,
      { ...BASE, startTime: "10:00", endTime: "18:00" },
      "2026-09-01",
    );

    expect(result.skippedDetached).toBe(1);

    const after = await seriesShifts(series._id);
    const detached = after.find((s) => s._id.equals(target._id))!;
    const sibling = after.find((s) => s.occurrenceDate === "2026-09-16")!;

    expect(clinicTimeLabel(detached.startAt)).toBe("08:00"); // untouched
    expect(clinicTimeLabel(sibling.startAt)).toBe("10:00"); // moved
    expect(after).toHaveLength(8); // series still intact
  });
});

describe("deleting a single occurrence", () => {
  it("removes it and does not resurrect it when the series regenerates", async () => {
    const { series } = await createSeries(BASE);
    const shifts = await seriesShifts(series._id);
    const target = shifts.find((s) => s.occurrenceDate === "2026-09-16")!;

    await deleteShift(target._id);
    await excludeOccurrence(target);

    expect(await seriesShifts(series._id)).toHaveLength(7);
    expect((await readSeries(series._id)).exceptions).toContain("2026-09-16");

    // Regenerating must respect the exception.
    await updateSeries(series._id, BASE, "2026-09-01");

    const after = await seriesShifts(series._id);
    expect(after).toHaveLength(7);
    expect(after.map((s) => s.occurrenceDate)).not.toContain("2026-09-16");
  });
});

describe("changing the series", () => {
  it("adds and removes occurrences to match new weekdays", async () => {
    const { series } = await createSeries(BASE);

    // Mondays only.
    const { result } = await updateSeries(
      series._id,
      { ...BASE, weekdays: [1] },
      "2026-09-01",
    );

    expect(result.removed).toBe(4); // the Wednesdays
    const after = await seriesShifts(series._id);
    expect(after).toHaveLength(4);
    expect(after.every((s) => s.occurrenceDate !== "2026-09-09")).toBe(true);
  });

  it("moves surviving claimants' bookings with the shift", async () => {
    const { series } = await createSeries(BASE);
    const nurse = await makeUser("nurse");
    const shifts = await seriesShifts(series._id);

    await claimShift({
      shiftId: shifts[0]._id,
      targetUser: nurse,
      actorId: nurse._id,
    });

    await updateSeries(
      series._id,
      { ...BASE, startTime: "10:00", endTime: "18:00" },
      "2026-09-01",
    );

    const booking = (await readUser(nurse._id)).bookings[0];
    expect(clinicTimeLabel(booking.startAt)).toBe("10:00");
    expect(clinicTimeLabel(booking.endAt)).toBe("18:00");
  });

  it("will not silently delete an occurrence somebody is on", async () => {
    const { series } = await createSeries(BASE);
    const nurse = await makeUser("nurse");
    const shifts = await seriesShifts(series._id);
    const wednesday = shifts.find((s) => s.occurrenceDate === "2026-09-09")!;

    await claimShift({
      shiftId: wednesday._id,
      targetUser: nurse,
      actorId: nurse._id,
    });

    // Drop Wednesdays. The claimed one must survive and be reported.
    const { result } = await updateSeries(
      series._id,
      { ...BASE, weekdays: [1] },
      "2026-09-01",
    );

    expect(result.skippedClaimed).toBe(1);
    expect(result.removed).toBe(3); // the three unclaimed Wednesdays

    const after = await seriesShifts(series._id);
    expect(after.map((s) => s.occurrenceDate)).toContain("2026-09-09");
  });

  it("leaves past occurrences alone", async () => {
    const { series } = await createSeries(BASE);

    // Pretend today is mid-series.
    const { result } = await updateSeries(
      series._id,
      { ...BASE, startTime: "10:00", endTime: "18:00" },
      "2026-09-17",
    );

    const after = await seriesShifts(series._id);
    const past = after.find((s) => s.occurrenceDate === "2026-09-07")!;
    const future = after.find((s) => s.occurrenceDate === "2026-09-21")!;

    expect(clinicTimeLabel(past.startAt)).toBe("08:00"); // history preserved
    expect(clinicTimeLabel(future.startAt)).toBe("10:00");
    expect(result.updated).toBe(4); // 21, 23, 28, 30
  });
});

describe("deleting the series", () => {
  it("removes future unclaimed occurrences and keeps claimed ones as one-offs", async () => {
    const { series } = await createSeries(BASE);
    const nurse = await makeUser("nurse");
    const shifts = await seriesShifts(series._id);

    await claimShift({
      shiftId: shifts[1]._id,
      targetUser: nurse,
      actorId: nurse._id,
    });

    const result = await deleteSeries(series._id, "2026-09-01");
    expect(result.removed).toBe(7);
    expect(result.keptClaimed).toBe(1);

    const db = await getDb();
    const survivor = await db
      .collection<ShiftDoc>(COLLECTIONS.shifts)
      .findOne({ _id: shifts[1]._id });

    expect(survivor).not.toBeNull();
    expect(survivor!.seriesId).toBeNull(); // now an ordinary shift
    expect(survivor!.claims).toHaveLength(1);

    // And the series itself is gone.
    expect(
      await db
        .collection(COLLECTIONS.shiftSeries)
        .countDocuments({ _id: series._id }),
    ).toBe(0);
  });
});

describe("occurrences behave like ordinary shifts", () => {
  it("can be claimed, and the overlap rule applies across a series", async () => {
    const { series } = await createSeries(BASE);
    const nurse = await makeUser("nurse");
    const shifts = await seriesShifts(series._id);

    await claimShift({
      shiftId: shifts[0]._id,
      targetUser: nurse,
      actorId: nurse._id,
    });

    // A second series at an overlapping time on the same days.
    const { series: other } = await createSeries({
      ...BASE,
      startTime: "14:00",
      endTime: "22:00",
    });
    const overlapping = (await seriesShifts(other._id)).find(
      (s) => s.occurrenceDate === shifts[0].occurrenceDate,
    )!;

    await expect(
      claimShift({
        shiftId: overlapping._id,
        targetUser: nurse,
        actorId: nurse._id,
      }),
    ).rejects.toMatchObject({ code: "OVERLAPPING_CLAIM" });

    expect(clinicDayKey(shifts[0].startAt)).toBe("2026-09-07");
  });
});
