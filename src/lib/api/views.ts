import type { ObjectId } from "mongodb";
import {
  PROFESSIONS,
  type ImportReportDoc,
  type Profession,
  type ShiftDoc,
  type StaffCount,
  type UserDoc,
} from "@/lib/db/schema";
import { clinicDayKey, clinicTimeLabel } from "@/lib/time";

/**
 * Wire formats.
 *
 * Every date-derived string a screen needs -- the calendar day a shift belongs to,
 * its local start and end labels -- is computed here, in the clinic's timezone.
 * The browser is in whatever zone the user's laptop is set to, so letting the
 * client format these would put a night shift on the wrong day for anyone
 * travelling.
 */

export type ShiftStatus = "empty" | "partial" | "full";

export interface ClaimView {
  userId: string;
  name: string;
  profession: Profession;
  /** True when a manager put them on the shift rather than them claiming it. */
  assigned: boolean;
}

export interface ShiftView {
  id: string;
  /** Clinic-local day the shift *starts* on; a 22:00 shift belongs to that day. */
  date: string;
  startLabel: string;
  endLabel: string;
  startAt: string;
  endAt: string;
  crossesMidnight: boolean;
  requirements: StaffCount;
  filled: StaffCount;
  /** requirements - filled, floored at 0. Drives the "still missing" chips. */
  missing: StaffCount;
  status: ShiftStatus;
  claims: ClaimView[];
  /** Set when the viewer holds a claim on this shift. */
  claimedByMe: boolean;
  updatedAt: string;
  isRecurring: boolean;
}

function statusOf(requirements: StaffCount, filled: StaffCount): ShiftStatus {
  const totalFilled = PROFESSIONS.reduce((n, p) => n + filled[p], 0);
  if (totalFilled === 0) return "empty";
  const complete = PROFESSIONS.every((p) => filled[p] >= requirements[p]);
  return complete ? "full" : "partial";
}

export function toShiftView(
  shift: ShiftDoc,
  viewerId?: ObjectId | string,
): ShiftView {
  const viewer =
    typeof viewerId === "string" ? viewerId : viewerId?.toHexString();

  const missing = PROFESSIONS.reduce<StaffCount>(
    (acc, p) => {
      acc[p] = Math.max(0, shift.requirements[p] - shift.filled[p]);
      return acc;
    },
    { doctor: 0, nurse: 0, receptionist: 0 },
  );

  return {
    id: shift._id.toHexString(),
    date: clinicDayKey(shift.startAt),
    startLabel: clinicTimeLabel(shift.startAt),
    endLabel: clinicTimeLabel(shift.endAt),
    startAt: shift.startAt.toISOString(),
    endAt: shift.endAt.toISOString(),
    crossesMidnight: clinicDayKey(shift.startAt) !== clinicDayKey(shift.endAt),
    requirements: shift.requirements,
    filled: shift.filled,
    missing,
    status: statusOf(shift.requirements, shift.filled),
    claims: shift.claims.map((c) => ({
      userId: c.userId.toHexString(),
      name: c.name,
      profession: c.profession,
      assigned: c.assignedBy !== null,
    })),
    claimedByMe: viewer
      ? shift.claims.some((c) => c.userId.toHexString() === viewer)
      : false,
    updatedAt: shift.updatedAt.toISOString(),
    isRecurring: shift.seriesId !== null,
  };
}

export interface StaffView {
  id: string;
  name: string;
  email: string;
  profession: Profession;
  staffCode: string | null;
}

export function toStaffView(user: UserDoc): StaffView {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    profession: user.profession as Profession,
    staffCode: user.staffCode,
  };
}

export interface ImportReportSummaryView {
  id: string;
  createdAt: string;
  source: "seed" | "upload";
  kind: "staff" | "shifts";
  filename: string;
  summary: ImportReportDoc["summary"];
}

export function toReportSummaryView(
  report: ImportReportDoc,
): ImportReportSummaryView {
  return {
    id: report._id.toHexString(),
    createdAt: report.createdAt.toISOString(),
    source: report.source,
    kind: report.kind,
    filename: report.filename,
    summary: report.summary,
  };
}

export interface ImportReportDetailView extends ImportReportSummaryView {
  notes: string[];
  rows: ImportReportDoc["rows"];
}

export function toReportDetailView(
  report: ImportReportDoc,
): ImportReportDetailView {
  return {
    ...toReportSummaryView(report),
    notes: report.notes,
    rows: report.rows,
  };
}
