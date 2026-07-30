import { describe, expect, it } from "vitest";
import {
  buildShiftInterval,
  inferDateFormats,
  MAX_SHIFT_HOURS,
  parseDate,
  parseTime,
  type DateFormatProfile,
} from "./datetime";
import { clinicDayKey, clinicTimeLabel, durationHours } from "@/lib/time";

// Fixtures are verbatim values from the provided data/shifts.csv.

/** The profile the real file produces, used by the parseDate cases below. */
const REAL_PROFILE: DateFormatProfile = inferDateFormats([
  "2026-08-28",
  "05/08/2026",
  "29/08/2026", // 29 > 12 -> slash dates are day-first
  "08-13-2026", // 13 > 12 -> dash dates are month-first
  "08-08-2026",
]);

describe("inferDateFormats", () => {
  it("derives both conventions from the real file's evidence", () => {
    expect(REAL_PROFILE.slash).toBe("dmy");
    expect(REAL_PROFILE.dash).toBe("mdy");
  });

  it("cites the row that proved each convention", () => {
    expect(REAL_PROFILE.evidence.join(" ")).toContain("29/08/2026");
    expect(REAL_PROFILE.evidence.join(" ")).toContain("08-13-2026");
  });

  it("falls back to day-first and says so when nothing disambiguates", () => {
    const profile = inferDateFormats(["05/08/2026", "06/07/2026"]);
    expect(profile.slash).toBe("dmy");
    expect(profile.evidence.join(" ")).toContain("assumed day/month/year");
  });

  it("flags a file whose rows contradict each other", () => {
    const profile = inferDateFormats(["29/08/2026", "08/29/2026"]);
    expect(profile.evidence.join(" ")).toContain("inconsistent");
  });
});

describe("parseDate", () => {
  it("accepts ISO dates unchanged", () => {
    const result = parseDate("2026-08-28", REAL_PROFILE);
    expect(result.ok && result.value).toBe("2026-08-28");
  });

  it("reads slash dates as day/month/year", () => {
    expect(parseDate("05/08/2026", REAL_PROFILE)).toMatchObject({
      ok: true,
      value: "2026-08-05",
    });
    expect(parseDate("29/08/2026", REAL_PROFILE)).toMatchObject({
      ok: true,
      value: "2026-08-29",
    });
  });

  it("reads dash dates as month/day/year", () => {
    expect(parseDate("08-13-2026", REAL_PROFILE)).toMatchObject({
      ok: true,
      value: "2026-08-13",
    });
    expect(parseDate("08-08-2026", REAL_PROFILE)).toMatchObject({
      ok: true,
      value: "2026-08-08",
    });
  });

  it("rejects a well-formed but non-existent calendar date", () => {
    // shift 5110: 2026-02-30. February never has 30 days.
    const result = parseDate("2026-02-30", REAL_PROFILE);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("not a real calendar date");
  });

  it("rejects other impossible dates", () => {
    for (const bad of ["2026-13-01", "2026-00-10", "2027-02-29", "32/08/2026"]) {
      expect(parseDate(bad, REAL_PROFILE).ok, bad).toBe(false);
    }
  });

  it("rejects an empty or unrecognised date", () => {
    expect(parseDate("", REAL_PROFILE).ok).toBe(false);
    expect(parseDate("next Tuesday", REAL_PROFILE).ok).toBe(false);
    expect(parseDate("2026/08/05", REAL_PROFILE).ok).toBe(false);
  });
});

describe("parseTime", () => {
  it("parses a plain time", () => {
    expect(parseTime("09:00", "start_time")).toMatchObject({
      ok: true,
      value: { hour: 9, minute: 0, dayOffset: 0 },
    });
    expect(parseTime("07:30", "start_time")).toMatchObject({
      ok: true,
      value: { hour: 7, minute: 30, dayOffset: 0 },
    });
  });

  it("parses the +1 next-day suffix", () => {
    // shift 5115: end_time "10:00+1"
    expect(parseTime("10:00+1", "end_time")).toMatchObject({
      ok: true,
      value: { hour: 10, minute: 0, dayOffset: 1 },
    });
  });

  it("treats midnight as 00:00 on the same notional day", () => {
    expect(parseTime("00:00", "end_time")).toMatchObject({
      ok: true,
      value: { hour: 0, minute: 0, dayOffset: 0 },
    });
  });

  it("rejects an empty time", () => {
    // shift 5114 has no start_time
    const result = parseTime("", "start_time");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("start_time");
  });

  it("rejects out-of-range and malformed times", () => {
    for (const bad of ["24:00", "25:00", "08:60", "8", "eight", "08:0"]) {
      expect(parseTime(bad, "start_time").ok, bad).toBe(false);
    }
  });
});

describe("buildShiftInterval", () => {
  const t = (hour: number, minute = 0, dayOffset = 0) => ({
    hour,
    minute,
    dayOffset,
  });

  it("builds an ordinary daytime shift", () => {
    const result = buildShiftInterval("2026-08-17", t(8), t(16));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(durationHours(result.value.startAt, result.value.endAt)).toBe(8);
    expect(result.value.crossesMidnight).toBe(false);
  });

  it("infers a midnight crossing for a night shift", () => {
    // shift 5103: 22:00 -> 06:00 is 8 hours, not a negative span
    const result = buildShiftInterval("2026-08-29", t(22), t(6));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(durationHours(result.value.startAt, result.value.endAt)).toBe(8);
    expect(result.value.crossesMidnight).toBe(true);
    // Asserted in clinic-local terms rather than as a fixed UTC instant: what
    // this test is about is the midnight inference, and the absolute instant
    // legitimately differs with the configured zone.
    expect(clinicTimeLabel(result.value.startAt)).toBe("22:00");
    expect(clinicTimeLabel(result.value.endAt)).toBe("06:00");
    expect(clinicDayKey(result.value.endAt)).toBe("2026-08-30");
  });

  it("treats a 00:00 end as the following midnight", () => {
    // shift 5097: 16:00 -> 00:00 is 8 hours
    const result = buildShiftInterval("2026-08-28", t(16), t(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(durationHours(result.value.startAt, result.value.endAt)).toBe(8);
    expect(result.value.crossesMidnight).toBe(true);
  });

  it("rejects a zero-length shift with a specific reason", () => {
    // shift 5112: 12:00 -> 12:00. Reporting this as a 24-hour shift would be
    // technically consistent but useless to whoever has to fix the row.
    const result = buildShiftInterval("2026-08-15", t(12), t(12));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("no duration");
  });

  it("rejects an implausibly long shift from a transposed time", () => {
    // shift 5109: 15:00 -> 09:00 reads as 18 hours
    const result = buildShiftInterval("2026-08-12", t(15), t(9));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("18");
    expect(result.reason).toContain(String(MAX_SHIFT_HOURS));
  });

  it("rejects an explicit +1 that produces a 26-hour shift", () => {
    // shift 5115: 08:00 -> 10:00+1
    const result = buildShiftInterval("2026-08-21", t(8), t(10, 0, 1));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("26");
  });

  it("accepts a legitimate double shift at exactly the limit", () => {
    const result = buildShiftInterval("2026-08-17", t(8), t(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(durationHours(result.value.startAt, result.value.endAt)).toBe(16);
  });
});
