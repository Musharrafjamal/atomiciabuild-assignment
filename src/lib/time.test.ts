import { describe, expect, it } from "vitest";
import {
  addWeeks,
  clinicDayKey,
  clinicInstant,
  clinicTimeLabel,
  durationHours,
  intervalsOverlap,
  weekBounds,
  weekDayKeys,
} from "./time";

// All fixtures use Europe/London (the default CLINIC_TZ), which is UTC+1 in August
// and UTC+0 in January. Asserting across both proves DST is actually handled rather
// than a fixed offset being applied.

describe("clinicInstant", () => {
  it("converts a summer (BST) wall-clock time to the right UTC instant", () => {
    // 2026-08-15 is in British Summer Time: 08:00 local == 07:00Z
    expect(clinicInstant("2026-08-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-08-15T07:00:00.000Z",
    );
  });

  it("converts a winter (GMT) wall-clock time to the right UTC instant", () => {
    // 2026-01-15 is in GMT: 08:00 local == 08:00Z
    expect(clinicInstant("2026-01-15", { hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("rolls the calendar day forward for shifts crossing midnight", () => {
    // Shift 5103 in the provided CSV: 2026-08-29, 22:00 -> 06:00
    const start = clinicInstant("2026-08-29", { hour: 22, minute: 0 });
    const end = clinicInstant("2026-08-29", { hour: 6, minute: 0 }, 1);

    expect(start.toISOString()).toBe("2026-08-29T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-30T05:00:00.000Z");
    expect(durationHours(start, end)).toBe(8);
  });

  it("rolls across a month boundary", () => {
    // Shift 5108: 2026-08-30, 16:00 -> 00:00 lands on 31 Aug; a 31st would land in Sep
    const end = clinicInstant("2026-08-31", { hour: 0, minute: 0 }, 1);
    expect(clinicDayKey(end)).toBe("2026-09-01");
  });
});

describe("intervalsOverlap", () => {
  const day = "2026-08-17";
  const at = (h: number, offset = 0) =>
    clinicInstant(day, { hour: h, minute: 0 }, offset);

  it("treats back-to-back shifts as NOT overlapping", () => {
    // 08:00-16:00 followed by 16:00-00:00 is a legitimate double shift.
    // A closed-interval comparison would wrongly reject the second claim.
    expect(intervalsOverlap(at(8), at(16), at(16), at(0, 1))).toBe(false);
  });

  it("detects a partial overlap", () => {
    expect(intervalsOverlap(at(8), at(16), at(14), at(22))).toBe(true);
  });

  it("detects full containment in both directions", () => {
    expect(intervalsOverlap(at(8), at(20), at(10), at(12))).toBe(true);
    expect(intervalsOverlap(at(10), at(12), at(8), at(20))).toBe(true);
  });

  it("detects an overnight shift overlapping the following morning", () => {
    // 22:00 -> 06:00 against 05:00 -> 13:00 the next day
    const nightStart = at(22);
    const nightEnd = at(6, 1);
    const morningStart = at(5, 1);
    const morningEnd = at(13, 1);
    expect(intervalsOverlap(nightStart, nightEnd, morningStart, morningEnd)).toBe(
      true,
    );
  });

  it("treats disjoint days as not overlapping", () => {
    expect(intervalsOverlap(at(8), at(16), at(8, 2), at(16, 2))).toBe(false);
  });
});

describe("clinicDayKey / clinicTimeLabel", () => {
  it("attributes a late-night shift to the day it starts", () => {
    const start = clinicInstant("2026-08-29", { hour: 22, minute: 0 });
    expect(clinicDayKey(start)).toBe("2026-08-29");
    expect(clinicTimeLabel(start)).toBe("22:00");
  });

  it("renders the local label, not the UTC one", () => {
    // 07:30 BST is 06:30Z -- the label must still read 07:30
    const start = clinicInstant("2026-08-25", { hour: 7, minute: 30 });
    expect(start.toISOString()).toBe("2026-08-25T06:30:00.000Z");
    expect(clinicTimeLabel(start)).toBe("07:30");
  });
});

describe("weekBounds", () => {
  it("returns Monday..next-Monday for a Saturday", () => {
    // 2026-08-15 is a Saturday; its week runs Mon 10 Aug -> Mon 17 Aug
    const { start, end } = weekBounds("2026-08-15");
    expect(clinicDayKey(start)).toBe("2026-08-10");
    expect(clinicDayKey(end)).toBe("2026-08-17");
  });

  it("returns the same week when given the Monday itself", () => {
    // 2026-08-03 is a Monday and must not roll back to the previous week
    const { start, end } = weekBounds("2026-08-03");
    expect(clinicDayKey(start)).toBe("2026-08-03");
    expect(clinicDayKey(end)).toBe("2026-08-10");
  });

  it("starts at local midnight", () => {
    const { start } = weekBounds("2026-08-15");
    expect(clinicTimeLabel(start)).toBe("00:00");
    expect(start.toISOString()).toBe("2026-08-09T23:00:00.000Z"); // 00:00 BST
  });
});

describe("weekDayKeys", () => {
  it("lists the seven days of the week, Monday first", () => {
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

  it("stays aligned across the autumn DST boundary", () => {
    // UK clocks go back on Sunday 25 October 2026. Stepping in fixed 24h
    // increments instead of calendar days would repeat a day here.
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
});

describe("addWeeks", () => {
  it("steps forward and back by whole weeks", () => {
    expect(addWeeks("2026-08-15", 1)).toBe("2026-08-22");
    expect(addWeeks("2026-08-15", -1)).toBe("2026-08-08");
    expect(addWeeks("2026-08-15", 0)).toBe("2026-08-15");
  });

  it("crosses a month boundary", () => {
    expect(addWeeks("2026-08-29", 1)).toBe("2026-09-05");
  });
});
