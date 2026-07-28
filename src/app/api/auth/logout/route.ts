import { clearSessionCookie } from "@/lib/auth/session";
import { handler, ok } from "@/lib/api/respond";

export const POST = handler(async () => {
  await clearSessionCookie();
  return ok({ ok: true });
});
