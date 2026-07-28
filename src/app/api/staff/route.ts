import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type UserDoc } from "@/lib/db/schema";
import { handler, ok } from "@/lib/api/respond";
import { toStaffView } from "@/lib/api/views";
import { requireManager } from "@/lib/auth/guards";

/** GET /api/staff — the roster, for the manager's assign dialog. */
export const GET = handler(async () => {
  await requireManager();
  const db = await getDb();

  const staff = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .find(
      { role: "staff" },
      { projection: { passwordHash: 0, bookings: 0 }, sort: { name: 1 } },
    )
    .toArray();

  return ok({ staff: staff.map(toStaffView) });
});
