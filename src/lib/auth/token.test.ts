import { describe, expect, it } from "vitest";
import { signSession, verifySession, type SessionPayload } from "./token";

const staff: SessionPayload = {
  userId: "65f000000000000000000001",
  name: "Ivy Bell",
  email: "ivy.bell@clinicmail.test",
  role: "staff",
  profession: "nurse",
};

const manager: SessionPayload = {
  userId: "65f000000000000000000002",
  name: "Clinic Manager",
  email: "manager@clinic.test",
  role: "manager",
  profession: null,
};

describe("session tokens", () => {
  it("round-trips a staff session", async () => {
    const token = await signSession(staff);
    expect(await verifySession(token)).toEqual(staff);
  });

  it("round-trips a manager session with a null profession", async () => {
    const token = await signSession(manager);
    expect(await verifySession(token)).toEqual(manager);
  });

  it("returns null for a missing token instead of throwing", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession(staff);
    const [header, payload, signature] = token.split(".");

    // Re-encode the payload with role escalated to manager, keeping the original
    // signature. This must fail: it is the attack the signature exists to stop.
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    decoded.role = "manager";
    const forged = Buffer.from(JSON.stringify(decoded)).toString("base64url");

    expect(await verifySession(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-completely-different-secret-value-here";
    const foreign = await signSession(manager);
    process.env.AUTH_SECRET = original;

    expect(await verifySession(foreign)).toBeNull();
  });

  it("rejects an unsigned `alg: none` token", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(manager)).toString("base64url");

    expect(await verifySession(`${header}.${payload}.`)).toBeNull();
  });

  it("rejects structurally valid garbage", async () => {
    for (const bad of ["not.a.token", "abc", "a.b.c.d"]) {
      expect(await verifySession(bad), bad).toBeNull();
    }
  });
});
