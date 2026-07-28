import { ZERO_COUNT, type StaffCount } from "@/lib/db/schema";
import { normalizeProfession, squish, type Normalized } from "./normalize";

const ok = <T>(value: T): Normalized<T> => ({ ok: true, value });
const fail = <T>(reason: string): Normalized<T> => ({ ok: false, reason });

/**
 * Parse the `requirements` column, e.g. `nurses=3;doctors=1;receptionists=1`.
 *
 * Professions absent from the string default to zero, so `nurses=1` is a valid
 * shift needing one nurse and nobody else.
 *
 * Free-text values such as `two nurses and a doctor` are **rejected rather than
 * interpreted**. Parsing English number words would work for that one row and
 * then quietly mis-staff a shift the first time someone writes "a couple of
 * nurses" or "2-3 nurses". Rostering the wrong number of clinical staff is worse
 * than refusing the row, and the report tells the manager exactly which row to
 * retype.
 */
export function parseRequirements(raw: string): Normalized<StaffCount> {
  const value = squish(raw);
  if (!value) return fail("requirements is empty");

  const counts: StaffCount = { ...ZERO_COUNT };
  const seen = new Set<string>();

  for (const part of value.split(";")) {
    const piece = squish(part);
    if (!piece) continue;

    const eq = piece.indexOf("=");
    if (eq === -1) {
      return fail(
        `requirements "${value}" is not in the expected \`role=count\` format`,
      );
    }

    const rawKey = piece.slice(0, eq);
    const rawCount = squish(piece.slice(eq + 1));

    const profession = normalizeProfession(rawKey);
    if (!profession.ok) {
      return fail(`requirements "${value}": ${profession.reason}`);
    }

    if (!/^\d+$/.test(rawCount)) {
      return fail(
        `requirements "${value}": "${rawCount}" is not a whole number of ${profession.value}s`,
      );
    }

    if (seen.has(profession.value)) {
      return fail(
        `requirements "${value}" lists ${profession.value}s more than once`,
      );
    }
    seen.add(profession.value);

    counts[profession.value] = Number(rawCount);
  }

  const total = counts.doctor + counts.nurse + counts.receptionist;
  if (total === 0) {
    return fail(`requirements "${value}" asks for no staff at all`);
  }

  return ok(counts);
}
