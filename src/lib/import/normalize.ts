import type { Profession } from "@/lib/db/schema";

/**
 * Field-level normalisers for the clinic's spreadsheet exports.
 *
 * Every function here returns either a value or a human-readable reason for
 * refusing it. The reason string goes straight onto the import report, so it is
 * written for a clinic manager rather than a developer.
 */

export type Normalized<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): Normalized<T> => ({ ok: true, value });
const fail = <T>(reason: string): Normalized<T> => ({ ok: false, reason });

/* -------------------------------------------------------------------------- */
/* Whitespace                                                                  */
/* -------------------------------------------------------------------------- */

/** Trim and collapse internal runs of whitespace. */
export function squish(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------------------- */
/* Professions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The clinic's spreadsheet uses at least four spellings per profession, varying
 * in case, abbreviation and clinical synonym. Mapping is exact-match against a
 * squished, lower-cased key -- deliberately not fuzzy, because silently guessing
 * at an unrecognised job title is how a janitor ends up rostered as a nurse.
 * Anything unlisted is rejected and surfaced on the report for a human to decide.
 */
const PROFESSION_SYNONYMS: Record<string, Profession> = {
  // doctor
  doctor: "doctor",
  doctors: "doctor",
  md: "doctor",
  physician: "doctor",
  dr: "doctor",
  // nurse
  nurse: "nurse",
  nurses: "nurse",
  rn: "nurse",
  "registered nurse": "nurse",
  // receptionist
  receptionist: "receptionist",
  receptionists: "receptionist",
  reception: "receptionist",
  "recep.": "receptionist",
  recep: "receptionist",
};

export function normalizeProfession(raw: string): Normalized<Profession> {
  const key = squish(raw).toLowerCase();
  if (!key) return fail("role is empty");

  const match = PROFESSION_SYNONYMS[key];
  if (!match) {
    return fail(
      `role "${squish(raw)}" is not a recognised clinical role (expected doctor, nurse or receptionist)`,
    );
  }
  return ok(match);
}

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Trim, collapse whitespace, and title-case tokens that arrived fully upper-cased.
 *
 * The title-casing is narrow on purpose: it only touches tokens that are entirely
 * A-Z and at least two characters ("ALI" -> "Ali"), so mixed-case names that are
 * already correct -- McDonald, O'Brien, van der Berg -- are left untouched.
 */
export function normalizeName(raw: string): Normalized<string> {
  const squished = squish(raw);
  if (!squished) return fail("full_name is empty");

  const cased = squished
    .split(" ")
    .map((token) =>
      /^[A-Z]{2,}$/.test(token)
        ? token.charAt(0) + token.slice(1).toLowerCase()
        : token,
    )
    .join(" ");

  return ok(cased);
}

/* -------------------------------------------------------------------------- */
/* Emails                                                                      */
/* -------------------------------------------------------------------------- */

// Deliberately permissive: this guards against obvious junk, not RFC compliance.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email is the login identifier, so a row without a usable one cannot become an
 * account and is rejected rather than imported half-formed.
 *
 * The one repair applied is `(at)` -> `@`, which appears in the export where a
 * spreadsheet or mail client mangled the address. It is an unambiguous
 * substitution: `(at)` is not otherwise legal in an address.
 */
export function normalizeEmail(raw: string): Normalized<string> {
  const squished = squish(raw).toLowerCase();
  if (!squished) return fail("email is empty and is required to create a login");

  const repaired = squished.replace(/\(at\)/g, "@");

  if (!EMAIL_RE.test(repaired)) {
    return fail(`email "${squish(raw)}" is not a valid address`);
  }

  return ok(repaired);
}

/** Whether normalizeEmail would have had to repair `(at)`. Used for report text. */
export function emailNeededRepair(raw: string): boolean {
  return squish(raw).toLowerCase().includes("(at)");
}
