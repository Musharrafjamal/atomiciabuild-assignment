import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  normalizeName,
  normalizeProfession,
  squish,
} from "./normalize";

// Every fixture below is a verbatim value from the provided data/staff.csv.

describe("squish", () => {
  it("trims and collapses whitespace", () => {
    expect(squish("  Karan ALI")).toBe("Karan ALI");
    expect(squish(" Nurse ")).toBe("Nurse");
    expect(squish("DOCTOR ")).toBe("DOCTOR");
    expect(squish("a   b")).toBe("a b");
  });

  it("handles null and undefined", () => {
    expect(squish(undefined)).toBe("");
    expect(squish(null)).toBe("");
  });
});

describe("normalizeProfession", () => {
  it("maps every doctor spelling in the file", () => {
    for (const raw of ["Doctor", "DOCTOR ", "MD", "Physician", "doctor"]) {
      const result = normalizeProfession(raw);
      expect(result.ok && result.value, raw).toBe("doctor");
    }
  });

  it("maps every nurse spelling in the file", () => {
    for (const raw of ["NURSE", "RN", "Registered Nurse", "nurse", " Nurse "]) {
      const result = normalizeProfession(raw);
      expect(result.ok && result.value, raw).toBe("nurse");
    }
  });

  it("maps every receptionist spelling in the file", () => {
    for (const raw of ["receptionist", "Reception", "recep.", "Receptionist"]) {
      const result = normalizeProfession(raw);
      expect(result.ok && result.value, raw).toBe("receptionist");
    }
  });

  it("rejects a non-clinical role rather than guessing", () => {
    // staff_id 997, Casey Morgan
    const result = normalizeProfession("Janitor");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("Janitor");
  });

  it("rejects an empty role", () => {
    expect(normalizeProfession("").ok).toBe(false);
    expect(normalizeProfession("   ").ok).toBe(false);
  });

  it("does not fuzzy-match a near miss", () => {
    // Guessing here is what puts unqualified people on clinical shifts.
    expect(normalizeProfession("nursing assistant").ok).toBe(false);
    expect(normalizeProfession("doctor's assistant").ok).toBe(false);
  });
});

describe("normalizeName", () => {
  it("trims leading whitespace and title-cases an all-caps token", () => {
    // staff_id 133: "  Karan ALI"
    const result = normalizeName("  Karan ALI");
    expect(result.ok && result.value).toBe("Karan Ali");
  });

  it("leaves correctly mixed-case names alone", () => {
    for (const name of ["Marcus Whitfield", "J. Placeholder", "Anya Haddad"]) {
      const result = normalizeName(name);
      expect(result.ok && result.value, name).toBe(name);
    }
  });

  it("does not mangle names that legitimately contain capitals", () => {
    for (const name of ["Ronan McDonald", "Aoife O'Brien", "Jan van der Berg"]) {
      const result = normalizeName(name);
      expect(result.ok && result.value, name).toBe(name);
    }
  });

  it("rejects an empty name", () => {
    // staff_id 996 has no full_name
    const result = normalizeName("");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("full_name");
  });
});

describe("normalizeEmail", () => {
  it("repairs the (at) mangling", () => {
    // staff_id 122 and 115
    const a = normalizeEmail("priya.weber(at)clinicmail.test");
    expect(a.ok && a.value).toBe("priya.weber@clinicmail.test");

    const b = normalizeEmail("fatima.petrova(at)clinicmail.test");
    expect(b.ok && b.value).toBe("fatima.petrova@clinicmail.test");
  });

  it("lower-cases and trims", () => {
    const result = normalizeEmail("  Marcus.Whitfield@ClinicMail.test ");
    expect(result.ok && result.value).toBe("marcus.whitfield@clinicmail.test");
  });

  it("rejects an empty email because it is the login identifier", () => {
    // staff_id 995, Robin Vale
    const result = normalizeEmail("");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("login");
  });

  it("rejects an address that is still malformed after repair", () => {
    for (const bad of ["not-an-email", "a@b", "@clinicmail.test", "a b@c.test"]) {
      expect(normalizeEmail(bad).ok, bad).toBe(false);
    }
  });
});
