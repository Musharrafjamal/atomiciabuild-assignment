import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWeeks,
  clinicDayKey,
  clinicInstant,
  clinicTimeLabel,
  clinicTz,
  durationHours,
  eachClinicDay,
  intervalsOverlap,
  weekBounds,
  weekDayKeys,
} from "./time";

/**
 * These tests pin the timezone rather than inheriting whatever the developer has
 * in `.env.local`, for two reasons:
 *
 *  - They must give the same answer on every machine and in CI.
 *  - The two zones exercise different hazards. Europe/London has daylight saving,
 *    which is where week alignment and calendar stepping go wrong. Asia/Kolkata
 *    is UTC+5:30, which is where code that assumes whole-hour offsets goes wrong.
 *    Testing only the configured zone would leave one of those uncovered.
 *
 * The application's own zone is configuration (`CLINIC_TZ`); that it is honoured
 * is verified by the "configured zone" block at the bottom.
 */

const original = {
  tz: process.env.CLINIC_TZ,
  publicTz: process.env.NEXT_PUBLIC_CLINIC_TZ,
};

function useZone(zone: string) {
  process.env.CLINIC_TZ = zone;
  process.env.NEXT_PUBLIC_CLINIC_TZ = zone;
}

afterEach(() => {
  process.env.CLINIC_TZ = original.tz;
  process.env.NEXT_PUBLIC_CLINIC_TZ = original.publicTz;
});

/* ========================================================================== */
/* A zone with daylight saving                                                */
/* ========================================================================== */

describe("Europe/London (daylight saving)", () => {
  beforeEach(() => useZone("Europe/London"));

  it("converts a summer wall-clock time to the right instant", () => {
    // British Summer Time: 08:00 local is 07:00Z
    expect(clinicInstant("2026-08-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-08-15T07:00:00.000Z",
    );
  });

  it("converts a winter wall-clock time to the right instant", () => {
    // GMT: 08:00 local is 08:00Z. Same input, different offset -- which is the
    // whole reason the zone database is involved instead of a fixed offset.
    expect(clinicInstant("2026-01-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("keeps a week seven distinct days across the autumn change", () => {
    // Clocks go back on Sunday 25 October 2026. Stepping in fixed 24-hour
    // increments instead of calendar days repeats or drops a day here.
    expect(weekDayKeys("2026-10-21")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });

  it("keeps a date range seven distinct days across the spring change", () => {
    // Clocks go forward on Sunday 29 March 2026.
    const days = eachClinicDay("2026-03-27", "2026-03-31");
    expect(days).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
  });
});

/* ========================================================================== */
/* A zone with a half-hour offset and no daylight saving                      */
/* ========================================================================== */

describe("Asia/Kolkata (UTC+5:30, no daylight saving)", () => {
  beforeEach(() => useZone("Asia/Kolkata"));

  it("handles the half-hour offset", () => {
    // 08:00 IST is 02:30Z. Code that assumes whole-hour offsets fails here.
    expect(clinicInstant("2026-08-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-08-15T02:30:00.000Z",
    );
    expect(clinicInstant("2026-01-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-01-15T02:30:00.000Z",
    );
  });

  it("round-trips a wall-clock label through the half-hour offset", () => {
    const start = clinicInstant("2026-08-25", { hour: 7, minute: 30 });
    expect(start.toISOString()).toBe("2026-08-25T02:00:00.000Z");
    expect(clinicTimeLabel(start)).toBe("07:30");
  });

  it("puts a night shift on the day it starts", () => {
    // 22:00 IST is 16:30Z -- the same calendar day in UTC, unlike London where
    // it would still be the same day but for a different reason. The day key
    // must follow the clinic's clock either way.
    const start = clinicInstant("2026-08-29", { hour: 22, minute: 0 });
    const end = clinicInstant("2026-08-29", { hour: 6, minute: 0 }, 1);

    expect(start.toISOString()).toBe("2026-08-29T16:30:00.000Z");
    expect(end.toISOString()).toBe("2026-08-30T00:30:00.000Z");
    expect(clinicDayKey(start)).toBe("2026-08-29");
    expect(durationHours(start, end)).toBe(8);
  });

  it("starts a week at local midnight, not UTC midnight", () => {
    const { start } = weekBounds("2026-08-15");
    expect(clinicDayKey(start)).toBe("2026-08-10");
    expect(clinicTimeLabel(start)).toBe("00:00");
    // 00:00 IST on the 10th is 18:30Z on the 9th.
    expect(start.toISOString()).toBe("2026-08-09T18:30:00.000Z");
  });
});

/* ========================================================================== */
/* Behaviour that holds in any zone                                           */
/* ========================================================================== */

describe.each(["Europe/London", "Asia/Kolkata"])("in %s", (zone) => {
  beforeEach(() => useZone(zone));

  it("treats back-to-back shifts as NOT overlapping", () => {
    // 08:00-16:00 then 16:00-00:00 is a legitimate double shift. A closed
    // interval comparison would wrongly refuse the second claim.
    const day = "2026-08-17";
    const at = (h: number, o = 0) => clinicInstant(day, { hour: h, minute: 0 }, o);
    expect(intervalsOverlap(at(8), at(16), at(16), at(0, 1))).toBe(false);
  });

  it("detects partial overlap, containment, and the overnight case", () => {
    const day = "2026-08-17";
    const at = (h: number, o = 0) => clinicInstant(day, { hour: h, minute: 0 }, o);

    expect(intervalsOverlap(at(8), at(16), at(14), at(22))).toBe(true);
    expect(intervalsOverlap(at(8), at(20), at(10), at(12))).toBe(true);
    expect(intervalsOverlap(at(10), at(12), at(8), at(20))).toBe(true);
    // 22:00-06:00 against 05:00-13:00 the next morning
    expect(intervalsOverlap(at(22), at(6, 1), at(5, 1), at(13, 1))).toBe(true);
    // Different days entirely
    expect(intervalsOverlap(at(8), at(16), at(8, 2), at(16, 2))).toBe(false);
  });

  it("gives an overnight shift the right duration and start day", () => {
    const start = clinicInstant("2026-08-29", { hour: 22, minute: 0 });
    const end = clinicInstant("2026-08-29", { hour: 6, minute: 0 }, 1);
    expect(durationHours(start, end)).toBe(8);
    expect(clinicDayKey(start)).toBe("2026-08-29");
    expect(clinicTimeLabel(start)).toBe("22:00");
    expect(clinicTimeLabel(end)).toBe("06:00");
  });

  it("rolls a 00:00 end into the next month correctly", () => {
    const end = clinicInstant("2026-08-31", { hour: 0, minute: 0 }, 1);
    expect(clinicDayKey(end)).toBe("2026-09-01");
  });

  it("returns Monday-to-Monday week bounds", () => {
    // 2026-08-15 is a Saturday.
    expect(clinicDayKey(weekBounds("2026-08-15").start)).toBe("2026-08-10");
    expect(clinicDayKey(weekBounds("2026-08-15").end)).toBe("2026-08-17");
    // Given the Monday itself, the week must not roll back.
    expect(clinicDayKey(weekBounds("2026-08-03").start)).toBe("2026-08-03");
  });

  it("lists the seven days of a week, Monday first", () => {
    expect(weekDayKeys("2026-08-15")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("steps by whole weeks, including across a month boundary", () => {
    expect(addWeeks("2026-08-15", 1)).toBe("2026-08-22");
    expect(addWeeks("2026-08-15", -1)).toBe("2026-08-08");
    expect(addWeeks("2026-08-15", 0)).toBe("2026-08-15");
    expect(addWeeks("2026-08-29", 1)).toBe("2026-09-05");
  });
});

/* ========================================================================== */
/* The zone is configuration, and it is honoured                              */
/* ========================================================================== */

describe("configured zone", () => {
  it("reads NEXT_PUBLIC_CLINIC_TZ first so the browser agrees with the server", () => {
    process.env.CLINIC_TZ = "Europe/London";
    process.env.NEXT_PUBLIC_CLINIC_TZ = "Asia/Kolkata";
    // Only the public variable is inlined into the client bundle, so it has to
    // win -- otherwise the two halves of the app would disagree about the day a
    // night shift falls on.
    expect(clinicTz()).toBe("Asia/Kolkata");
  });

  it("falls back to the server variable when no public one is set", () => {
    process.env.CLINIC_TZ = "Europe/London";
    delete process.env.NEXT_PUBLIC_CLINIC_TZ;
    expect(clinicTz()).toBe("Europe/London");
  });

  it("applies the configured zone to conversions", () => {
    useZone("America/New_York"); // UTC-4 in August
    expect(clinicInstant("2026-08-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-08-15T12:00:00.000Z",
    );
  });
});
