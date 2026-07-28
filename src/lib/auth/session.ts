import { cookies } from "next/headers";
import {
  MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type SessionPayload,
} from "./token";

export { verifySession, signSession, type SessionPayload } from "./token";

/**
 * Cookie plumbing for the session token.
 *
 * The payload carries enough to render the UI and to make the optimistic redirect
 * in proxy.ts without a database round-trip. It is deliberately not authority for
 * mutations: the claim engine re-reads the user document inside its transaction,
 * so a stale token cannot widen what a request is allowed to do.
 */

export const SESSION_COOKIE = "clinic_session";

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    // Vercel terminates TLS, so `secure` is right in production but would break
    // plain-HTTP local development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
