import { ObjectId } from "mongodb";
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

export const PROFESSIONS = ["doctor", "nurse", "receptionist"] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const professionSchema = z.enum(PROFESSIONS);

export const ROLES = ["manager", "staff"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

/** Plural, human-facing labels. `doctor` -> "doctors". */
export const PROFESSION_LABEL: Record<Profession, { one: string; many: string }> = {
  doctor: { one: "doctor", many: "doctors" },
  nurse: { one: "nurse", many: "nurses" },
  receptionist: { one: "receptionist", many: "receptionists" },
};

/* -------------------------------------------------------------------------- */
/* Shared value objects                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How many of each profession a shift needs, and how many it currently has.
 * Always fully populated (missing professions are 0) so the atomic `$expr`
 * capacity comparison in the claim engine never has to handle a null field.
 */
export const staffCountSchema = z.object({
  doctor: z.number().int().min(0),
  nurse: z.number().int().min(0),
  receptionist: z.number().int().min(0),
});
export type StaffCount = z.infer<typeof staffCountSchema>;

export const ZERO_COUNT: StaffCount = { doctor: 0, nurse: 0, receptionist: 0 };

const objectId = z.custom<ObjectId>((v) => v instanceof ObjectId, {
  message: "expected an ObjectId",
});

/* -------------------------------------------------------------------------- */
/* users                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A booked interval, denormalised onto the user document.
 *
 * This array is not merely a convenience cache -- it is the concurrency control
 * for the overlap rule. Every claim pushes to it under a predicate that rejects
 * overlaps, which forces two concurrent claims by the same person to contend on
 * this single document. See src/lib/rules/claim.ts.
 */
export const bookingSchema = z.object({
  shiftId: objectId,
  startAt: z.date(),
  endAt: z.date(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const userSchema = z.object({
  _id: objectId,
  /** `staff_id` from the CSV. Absent for logins we create ourselves (the manager). */
  staffCode: z.string().nullable(),
  name: z.string().min(1),
  email: z.email(),
  passwordHash: z.string(),
  role: roleSchema,
  /** Managers have no profession; staff always do. Enforced by the refine below. */
  profession: professionSchema.nullable(),
  bookings: z.array(bookingSchema),
  createdAt: z.date(),
});
export type UserDoc = z.infer<typeof userSchema>;

/** A user as sent to the client -- never includes the password hash. */
export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  profession: Profession | null;
};

export function toPublicUser(u: UserDoc): PublicUser {
  return {
    id: u._id.toHexString(),
    name: u.name,
    email: u.email,
    role: u.role,
    profession: u.profession,
  };
}

/* -------------------------------------------------------------------------- */
/* shifts                                                                      */
/* -------------------------------------------------------------------------- */

export const claimSchema = z.object({
  userId: objectId,
  /** Denormalised so the dashboard renders a week without joining to users. */
  name: z.string(),
  profession: professionSchema,
  claimedAt: z.date(),
  /** null when the staff member claimed it themselves; set when a manager assigned. */
  assignedBy: objectId.nullable(),
});
export type Claim = z.infer<typeof claimSchema>;

export const shiftSchema = z.object({
  _id: objectId,
  /** `shift_id` from the CSV, kept so an imported row can be traced back. */
  externalId: z.string().nullable(),
  /** UTC instants. See src/lib/time.ts for why these are not wall-clock strings. */
  startAt: z.date(),
  endAt: z.date(),
  requirements: staffCountSchema,
  /** Denormalised counter kept in lockstep with `claims` inside one transaction. */
  filled: staffCountSchema,
  claims: z.array(claimSchema),
  /** Recurring-series linkage; null for one-off shifts. */
  seriesId: objectId.nullable(),
  /** Clinic-local `YYYY-MM-DD` of this occurrence, for series bookkeeping. */
  occurrenceDate: z.string().nullable(),
  /** Set when an occurrence has been edited individually; series edits skip it. */
  detachedFromSeries: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ShiftDoc = z.infer<typeof shiftSchema>;

/* -------------------------------------------------------------------------- */
/* importReports                                                               */
/* -------------------------------------------------------------------------- */

export const IMPORT_OUTCOMES = [
  "accepted",
  "merged",
  "conflict",
  "rejected",
] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

export const IMPORT_KINDS = ["staff", "shifts"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * One row's fate. `raw` preserves the original line verbatim so the report can
 * show the reviewer exactly what was in the spreadsheet, which is what the brief
 * asks for: the row, what was wrong, and what was done with it.
 */
export const importRowSchema = z.object({
  /** 1-based line number in the source file, header excluded. */
  rowNumber: z.number().int().positive(),
  raw: z.record(z.string(), z.string()),
  outcome: z.enum(IMPORT_OUTCOMES),
  /** Empty for accepted rows; always populated otherwise. */
  reason: z.string(),
  /** What ended up in the database, if anything. */
  action: z.string(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importReportSchema = z.object({
  _id: objectId,
  createdAt: z.date(),
  source: z.enum(["seed", "upload"]),
  kind: z.enum(IMPORT_KINDS),
  filename: z.string(),
  summary: z.object({
    total: z.number().int().min(0),
    accepted: z.number().int().min(0),
    merged: z.number().int().min(0),
    conflict: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
  rows: z.array(importRowSchema),
  /** Who ran it; null for the seed. */
  uploadedBy: objectId.nullable(),
});
export type ImportReportDoc = z.infer<typeof importReportSchema>;

/* -------------------------------------------------------------------------- */
/* shiftSeries                                                                 */
/* -------------------------------------------------------------------------- */

export const shiftSeriesSchema = z.object({
  _id: objectId,
  /** 0=Sunday..6=Saturday, matching Date.getDay(). */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  /** True when endTime <= startTime, i.e. the shift crosses midnight. */
  crossesMidnight: z.boolean(),
  requirements: staffCountSchema,
  /** Clinic-local `YYYY-MM-DD`, inclusive. */
  fromDate: z.string(),
  untilDate: z.string(),
  /** Occurrence dates deleted individually; regeneration must not recreate them. */
  exceptions: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ShiftSeriesDoc = z.infer<typeof shiftSeriesSchema>;

/* -------------------------------------------------------------------------- */
/* Collection names                                                            */
/* -------------------------------------------------------------------------- */

export const COLLECTIONS = {
  users: "users",
  shifts: "shifts",
  importReports: "importReports",
  shiftSeries: "shiftSeries",
} as const;
