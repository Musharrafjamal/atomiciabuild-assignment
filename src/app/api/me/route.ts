import { handler, ok } from "@/lib/api/respond";
import { getSession } from "@/lib/auth/session";

/** GET /api/me — who am I? Returns null rather than 401 so the client can branch. */
export const GET = handler(async () => {
  const session = await getSession();
  return ok({ user: session });
});
