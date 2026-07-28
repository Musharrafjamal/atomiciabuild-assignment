import { TZDate } from "@date-fns/tz";

/**
 * The clinic operates in one timezone. Every date/time in the CSVs and in the UI is
 * a *clinic-local wall-clock* value; every date stored in MongoDB is a UTC instant.
 *
 * Keeping that boundary sharp is what makes overnight shifts work. `22:00 -> 06:00`
 * is not "22:00 and 06:00 on the same day", it is a single 8-hour interval that
 * crosses midnight. Storing wall-clock strings would make overlap detection depend
 * on string comparison and quietly break on every night shift; storing instants
 * makes it `aStart < bEnd && aEnd > bStart`.
 */
/**
 * Read from the public variable first so client components resolve the same zone
 * as the server. `process.env.CLINIC_TZ` is not inlined into the browser bundle,
 * so relying on it alone would silently fall back to the default on the client
 * and put a night shift on the wrong day for any clinic outside Europe/London.
 */
export const CLINIC_TZ =
  process.env.NEXT_PUBLIC_CLINIC_TZ || process.env.CLINIC_TZ || "Europe/London";

/** A wall-clock time of day, already validated. */
export interface WallTime {
  hour: number;
  minute: number;
}

/**
 * Build a UTC instant from a clinic-local calendar date and wall-clock time.
 *
 * `dayOffset` shifts the calendar day forward, which is how a shift that crosses
 * midnight is represented: the end time carries `dayOffset: 1`.
 *
 * DST is handled by TZDate: on a spring-forward day, 08:00 London is 07:00 UTC in
 * summer and 08:00 UTC in winter, and this returns the right instant for both.
 */
export function clinicInstant(
  isoDate: string,
  time: WallTime,
  dayOffset = 0,
): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  // TZDate months are 0-indexed. Passing `day + dayOffset` lets the Date
  // constructor roll over month and year boundaries for us (Aug 31 + 1 -> Sep 1).
  const tzd = TZDate.tz(
    CLINIC_TZ,
    year,
    month - 1,
    day + dayOffset,
    time.hour,
    time.minute,
  );
  return new Date(tzd.getTime());
}

/**
 * Half-open interval overlap: `[aStart, aEnd)` against `[bStart, bEnd)`.
 *
 * Half-open is deliberate. Back-to-back shifts (08:00-16:00 and 16:00-00:00) share
 * an endpoint and must NOT count as overlapping -- a nurse can legitimately work
 * one then the other. A closed-interval test would reject that pairing.
 */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/** Duration of an interval in hours. */
export function durationHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/**
 * The clinic-local calendar day an instant falls on, as `YYYY-MM-DD`.
 * Used to group shifts into day columns on the coverage dashboard -- a shift
 * starting 22:00 belongs to that day's column even though it ends the next day.
 */
export function clinicDayKey(instant: Date): string {
  const tzd = new TZDate(instant.getTime(), CLINIC_TZ);
  const y = tzd.getFullYear();
  const m = String(tzd.getMonth() + 1).padStart(2, "0");
  const d = String(tzd.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Clinic-local wall-clock time of an instant, as `HH:MM`. */
export function clinicTimeLabel(instant: Date): string {
  const tzd = new TZDate(instant.getTime(), CLINIC_TZ);
  return `${String(tzd.getHours()).padStart(2, "0")}:${String(
    tzd.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * Monday-to-Monday bounds of the clinic-local week containing `isoDate`.
 * Returned as instants so they can go straight into a Mongo range query.
 *
 * `end` is exclusive (the following Monday at 00:00).
 */
export function weekBounds(isoDate: string): { start: Date; end: Date } {
  const [year, month, day] = isoDate.split("-").map(Number);
  const midday = TZDate.tz(CLINIC_TZ, year, month - 1, day, 12, 0);
  // getDay(): 0=Sunday..6=Saturday. Map to days-since-Monday.
  const daysSinceMonday = (midday.getDay() + 6) % 7;

  const start = TZDate.tz(CLINIC_TZ, year, month - 1, day - daysSinceMonday, 0, 0);
  const end = TZDate.tz(
    CLINIC_TZ,
    year,
    month - 1,
    day - daysSinceMonday + 7,
    0,
    0,
  );
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The seven clinic-local day keys of the week containing `isoDate`, Monday first. */
export function weekDayKeys(isoDate: string): string[] {
  const { start } = weekBounds(isoDate);
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    // Step in clinic-local calendar days, not fixed 24h increments, so the week
    // stays aligned across a DST boundary.
    const tzd = new TZDate(start.getTime(), CLINIC_TZ);
    const stepped = TZDate.tz(
      CLINIC_TZ,
      tzd.getFullYear(),
      tzd.getMonth(),
      tzd.getDate() + i,
      12,
      0,
    );
    keys.push(clinicDayKey(new Date(stepped.getTime())));
  }
  return keys;
}

/** Today's clinic-local date as `YYYY-MM-DD`. */
export function clinicToday(): string {
  return clinicDayKey(new Date());
}

/**
 * Human-readable date, always rendered in the clinic's timezone.
 *
 * Everything user-facing goes through here rather than calling Intl directly, so
 * there is one place that knows which zone to format in.
 */
export function formatClinicDate(
  value: Date | string,
  options: Intl.DateTimeFormatOptions,
): string {
  const instant =
    typeof value === "string"
      ? // A bare YYYY-MM-DD is a clinic-local calendar day, not a UTC instant.
        /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? clinicInstant(value, { hour: 12, minute: 0 })
        : new Date(value)
      : value;

  return new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: CLINIC_TZ,
  }).format(instant);
}

/** Shift `isoDate` by whole clinic-local weeks; used by dashboard prev/next. */
export function addWeeks(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const tzd = TZDate.tz(CLINIC_TZ, year, month - 1, day + delta * 7, 12, 0);
  return clinicDayKey(new Date(tzd.getTime()));
}
