import { clinicInstant, durationHours } from "@/lib/time";
import { squish, type Normalized } from "./normalize";

const ok = <T>(value: T): Normalized<T> => ({ ok: true, value });
const fail = <T>(reason: string): Normalized<T> => ({ ok: false, reason });

/**
 * A shift longer than this is treated as a data-entry error rather than a real
 * roster entry. Every well-formed shift in the provided export is exactly 8
 * hours; 16 allows for a legitimate double shift while still catching the two
 * corrupted rows (`15:00 -> 09:00` reads as 18h, `08:00 -> 10:00+1` as 26h).
 */
export const MAX_SHIFT_HOURS = 16;

/* -------------------------------------------------------------------------- */
/* Date-format inference                                                       */
/* -------------------------------------------------------------------------- */

export type DateOrder = "dmy" | "mdy";

export interface DateFormatProfile {
  slash: DateOrder;
  dash: DateOrder;
  /** Human-readable justification, shown at the top of the import report. */
  evidence: string[];
}

const SLASH_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DASH_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Decide whether `05/08/2026` means 5 August or 8 May -- by looking at the whole
 * file rather than guessing per row.
 *
 * A single row is often ambiguous, but a file rarely is: if *any* row has a first
 * component above 12 then the first component must be the day, and the same
 * convention then applies to every row in that file. In the provided export
 * `29/08/2026` settles the slash format and `08-13-2026` settles the dash format.
 *
 * When a file genuinely never disambiguates, day-first is assumed (it is the
 * majority world convention and matches the ISO ordering already used elsewhere
 * in the file) and that assumption is recorded on the report rather than hidden.
 */
export function inferDateFormats(rawDates: string[]): DateFormatProfile {
  const evidence: string[] = [];

  const decide = (re: RegExp, label: string, sep: string): DateOrder => {
    let dayFirstProof: string | null = null;
    let monthFirstProof: string | null = null;

    for (const raw of rawDates) {
      const m = re.exec(squish(raw));
      if (!m) continue;
      const first = Number(m[1]);
      const second = Number(m[2]);
      if (first > 12 && !dayFirstProof) dayFirstProof = squish(raw);
      if (second > 12 && !monthFirstProof) monthFirstProof = squish(raw);
    }

    if (dayFirstProof && monthFirstProof) {
      // Genuinely contradictory: both orders are disproved. Day-first is kept as
      // the documented default and the contradiction is surfaced.
      evidence.push(
        `${label} dates are inconsistent ("${dayFirstProof}" implies day/month, "${monthFirstProof}" implies month/day); assumed day${sep}month${sep}year`,
      );
      return "dmy";
    }
    if (dayFirstProof) {
      evidence.push(
        `${label} dates read day${sep}month${sep}year (proved by "${dayFirstProof}")`,
      );
      return "dmy";
    }
    if (monthFirstProof) {
      evidence.push(
        `${label} dates read month${sep}day${sep}year (proved by "${monthFirstProof}")`,
      );
      return "mdy";
    }
    evidence.push(
      `no ${label} date disambiguates the order; assumed day${sep}month${sep}year`,
    );
    return "dmy";
  };

  const slash = decide(SLASH_RE, "slash-separated", "/");
  const dash = decide(DASH_RE, "dash-separated", "-");

  return { slash, dash, evidence };
}

/* -------------------------------------------------------------------------- */
/* Date parsing                                                                */
/* -------------------------------------------------------------------------- */

/** True only for dates that exist in the calendar -- rejects 30 February. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Parse a date in any of the three shapes present in the export, returning a
 * canonical `YYYY-MM-DD` clinic-local calendar date.
 *
 * Calendar validity is checked after parsing, which is what catches `2026-02-30`:
 * it is correctly *shaped* ISO but is not a real day.
 */
export function parseDate(
  raw: string,
  profile: DateFormatProfile,
): Normalized<string> {
  const value = squish(raw);
  if (!value) return fail("date is empty");

  const isoMatch = ISO_RE.exec(value);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number);
    if (!isRealDate(y, m, d)) {
      return fail(`date "${value}" is not a real calendar date`);
    }
    return ok(iso(y, m, d));
  }

  for (const [re, order] of [
    [SLASH_RE, profile.slash],
    [DASH_RE, profile.dash],
  ] as const) {
    const match = re.exec(value);
    if (!match) continue;

    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    const day = order === "dmy" ? first : second;
    const month = order === "dmy" ? second : first;

    if (!isRealDate(year, month, day)) {
      return fail(
        `date "${value}" is not a real calendar date when read as ${
          order === "dmy" ? "day/month/year" : "month/day/year"
        }`,
      );
    }
    return ok(iso(year, month, day));
  }

  return fail(`date "${value}" is not in a recognised format`);
}

/* -------------------------------------------------------------------------- */
/* Time parsing                                                                */
/* -------------------------------------------------------------------------- */

export interface ParsedTime {
  hour: number;
  minute: number;
  /** From an explicit `+1` suffix, meaning "this time, but the following day". */
  dayOffset: number;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?:\s*\+\s*(\d+))?$/;

export function parseTime(raw: string, field: string): Normalized<ParsedTime> {
  const value = squish(raw);
  if (!value) return fail(`${field} is empty`);

  const match = TIME_RE.exec(value);
  if (!match) return fail(`${field} "${value}" is not a valid time`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const dayOffset = match[3] ? Number(match[3]) : 0;

  if (hour > 23) return fail(`${field} "${value}" has an hour above 23`);
  if (minute > 59) return fail(`${field} "${value}" has a minute above 59`);

  return ok({ hour, minute, dayOffset });
}

/* -------------------------------------------------------------------------- */
/* Interval construction                                                       */
/* -------------------------------------------------------------------------- */

export interface ShiftInterval {
  startAt: Date;
  endAt: Date;
  /** True when the shift runs past midnight into the next calendar day. */
  crossesMidnight: boolean;
}

/**
 * Turn a calendar date plus two wall-clock times into a pair of UTC instants.
 *
 * An end time at or before the start is read as crossing midnight, which is what
 * makes `22:00 -> 06:00` and `16:00 -> 00:00` come out as 8-hour shifts. The two
 * degenerate cases are separated so the report can say what is actually wrong:
 * identical start and end is a zero-length shift, whereas an implausibly long
 * result is usually a transposed or mistyped time.
 */
export function buildShiftInterval(
  isoDate: string,
  start: ParsedTime,
  end: ParsedTime,
): Normalized<ShiftInterval> {
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  if (end.dayOffset === 0 && start.dayOffset === 0 && endMinutes === startMinutes) {
    return fail(
      `start and end are both ${String(start.hour).padStart(2, "0")}:${String(
        start.minute,
      ).padStart(2, "0")}, so the shift has no duration`,
    );
  }

  // Only infer a midnight crossing when no explicit +N offset was given.
  const inferredCrossing =
    end.dayOffset === 0 && endMinutes < startMinutes ? 1 : 0;
  const endOffset = end.dayOffset + inferredCrossing;

  const startAt = clinicInstant(isoDate, start, start.dayOffset);
  const endAt = clinicInstant(isoDate, end, endOffset);
  const hours = durationHours(startAt, endAt);

  if (hours <= 0) {
    return fail(`end time is before the start time and cannot be interpreted`);
  }
  if (hours > MAX_SHIFT_HOURS) {
    return fail(
      `shift would run ${Number(hours.toFixed(1))} hours, above the ${MAX_SHIFT_HOURS}-hour limit for a single shift`,
    );
  }

  return ok({ startAt, endAt, crossesMidnight: endOffset > 0 });
}
