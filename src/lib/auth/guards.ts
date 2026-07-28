import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type UserDoc } from "@/lib/db/schema";
import { forbidden, notFound, unauthenticated } from "@/lib/errors";
import { getSession, type SessionPayload } from "./session";

/**
 * Authorisation helpers. Every mutating route handler calls one of these before
 * doing anything else.
 *
 * The redirect in proxy.ts is a convenience for signed-out users; it is not a
 * security boundary (Next's own documentation is explicit that Proxy should not
 * be used as an authorisation solution). These functions are the boundary, and
 * they run inside the request that performs the work.
 */

export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  return session;
}

export async function requireManager(): Promise<SessionPayload> {
  const session = await requireUser();
  if (session.role !== "manager") {
    throw forbidden("Only managers can do that.");
  }
  return session;
}

/**
 * Load the full user document for the signed-in session.
 *
 * Used where the session payload is not sufficient -- in particular anything that
 * depends on `profession` or `bookings`, which must come from the database rather
 * than from a token the client holds.
 */
export async function loadCurrentUser(): Promise<UserDoc> {
  const session = await requireUser();
  const db = await getDb();
  const user = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .findOne({ _id: new ObjectId(session.userId) });
  if (!user) throw unauthenticated();
  return user;
}

/**
 * Resolve who a claim action is *for*, and confirm the caller may act on their
 * behalf.
 *
 * Staff may only ever pass their own id — this is the rule that stops one nurse
 * claiming a shift as another. Managers may pass anyone, which is how direct
 * assignment works. Both paths then run the identical claim logic.
 */
export async function resolveClaimTarget(
  actor: SessionPayload,
  targetUserId: string | undefined,
): Promise<UserDoc> {
  const wanted = targetUserId ?? actor.userId;

  if (actor.role !== "manager" && wanted !== actor.userId) {
    throw forbidden("You can only claim or release shifts for yourself.");
  }

  if (!ObjectId.isValid(wanted)) throw notFound("That staff member");

  const db = await getDb();
  const user = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .findOne({ _id: new ObjectId(wanted) });

  if (!user) throw notFound("That staff member");
  return user;
}
