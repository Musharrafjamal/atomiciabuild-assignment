import { describe, expect, it } from "vitest";
import { parseRequirements } from "./requirements";

describe("parseRequirements", () => {
  it("parses the standard three-role form", () => {
    expect(parseRequirements("nurses=3;doctors=1;receptionists=1")).toMatchObject({
      ok: true,
      value: { nurse: 3, doctor: 1, receptionist: 1 },
    });
  });

  it("defaults unlisted professions to zero", () => {
    // shift 5110: "nurses=1"
    expect(parseRequirements("nurses=1")).toMatchObject({
      ok: true,
      value: { nurse: 1, doctor: 0, receptionist: 0 },
    });
    // shift 5109: "nurses=2;doctors=1"
    expect(parseRequirements("nurses=2;doctors=1")).toMatchObject({
      ok: true,
      value: { nurse: 2, doctor: 1, receptionist: 0 },
    });
  });

  it("keeps explicit zeros", () => {
    // shift 5096: "nurses=3;doctors=0;receptionists=0"
    expect(parseRequirements("nurses=3;doctors=0;receptionists=0")).toMatchObject({
      ok: true,
      value: { nurse: 3, doctor: 0, receptionist: 0 },
    });
  });

  it("tolerates whitespace and ordering", () => {
    expect(parseRequirements("  doctors = 2 ; nurses=1 ")).toMatchObject({
      ok: true,
      value: { doctor: 2, nurse: 1, receptionist: 0 },
    });
  });

  it("rejects free text rather than guessing at it", () => {
    // shift 5113: "two nurses and a doctor". Interpreting English number words
    // here would mis-staff a clinical shift the first time the phrasing varies.
    const result = parseRequirements("two nurses and a doctor");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(
      "two nurses and a doctor",
    );
  });

  it("rejects an unknown role", () => {
    const result = parseRequirements("janitors=1;nurses=2");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("janitors");
  });

  it("rejects a non-numeric count", () => {
    expect(parseRequirements("nurses=two").ok).toBe(false);
    expect(parseRequirements("nurses=-1").ok).toBe(false);
    expect(parseRequirements("nurses=1.5").ok).toBe(false);
  });

  it("rejects a shift that asks for nobody", () => {
    const result = parseRequirements("nurses=0;doctors=0;receptionists=0");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("no staff");
  });

  it("rejects a duplicated profession key", () => {
    const result = parseRequirements("nurses=1;nurses=2");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("more than once");
  });

  it("rejects an empty value", () => {
    expect(parseRequirements("").ok).toBe(false);
  });
});
