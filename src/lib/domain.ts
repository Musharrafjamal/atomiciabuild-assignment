import { z } from "zod";

/**
 * The clinic's vocabulary: professions, roles, and staffing counts.
 *
 * Deliberately free of any database import. `db/schema.ts` needs `ObjectId` from
 * the mongodb driver, and a client component that imports a single constant from
 * there would pull the whole driver -- and its `dns`, `tls` and `fs` requires --
 * into the browser bundle. Keeping the vocabulary here lets UI components share
 * the same definitions the server uses without that happening.
 */

export const PROFESSIONS = ["doctor", "nurse", "receptionist"] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const professionSchema = z.enum(PROFESSIONS);

export const ROLES = ["manager", "staff"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

/** Singular and plural labels, so counts read naturally: "1 nurse", "2 nurses". */
export const PROFESSION_LABEL: Record<Profession, { one: string; many: string }> = {
  doctor: { one: "doctor", many: "doctors" },
  nurse: { one: "nurse", many: "nurses" },
  receptionist: { one: "receptionist", many: "receptionists" },
};

/**
 * How many of each profession a shift needs, and how many it has.
 * Always fully populated (absent professions are 0) so the atomic `$expr`
 * capacity comparison never has to cope with a missing field.
 */
export const staffCountSchema = z.object({
  doctor: z.number().int().min(0),
  nurse: z.number().int().min(0),
  receptionist: z.number().int().min(0),
});
export type StaffCount = z.infer<typeof staffCountSchema>;

export const ZERO_COUNT: StaffCount = { doctor: 0, nurse: 0, receptionist: 0 };

export const IMPORT_OUTCOMES = [
  "accepted",
  "merged",
  "conflict",
  "rejected",
] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

export const IMPORT_KINDS = ["staff", "shifts"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const COLLECTIONS = {
  users: "users",
  shifts: "shifts",
  importReports: "importReports",
  shiftSeries: "shiftSeries",
} as const;
