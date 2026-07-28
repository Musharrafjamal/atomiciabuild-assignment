import { SignJWT, jwtVerify } from "jose";
import type { Profession, Role } from "@/lib/db/schema";

/**
 * Signing and verification of the session token.
 *
 * Kept separate from session.ts (which imports `next/headers`) so the crypto can
 * be unit-tested without a request context, and so proxy.ts pulls in only this.
 */

const ALG = "HS256";
export const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  role: Role;
  profession: Profession | null;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or shorter than 16 characters. Copy .env.example to .env.local.",
    );
  }
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

/**
 * Returns null for a missing, malformed, expired, or badly-signed token rather
 * than throwing, so callers treat "no valid session" as one case.
 *
 * `algorithms` is pinned so a token claiming `alg: none` cannot be accepted.
 */
export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    const { userId, name, email, role, profession } = payload as Record<
      string,
      unknown
    >;
    if (typeof userId !== "string" || (role !== "manager" && role !== "staff")) {
      return null;
    }
    return {
      userId,
      name: String(name ?? ""),
      email: String(email ?? ""),
      role,
      profession: (profession ?? null) as Profession | null,
    };
  } catch {
    return null;
  }
}
