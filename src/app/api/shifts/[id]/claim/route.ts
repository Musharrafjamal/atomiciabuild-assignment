import { z } from "zod";
import { ObjectId } from "mongodb";
import { handler, ok, readJson } from "@/lib/api/respond";
import { toShiftView } from "@/lib/api/views";
import { requireUser, resolveClaimTarget } from "@/lib/auth/guards";
import { claimShift, releaseShift } from "@/lib/rules/claim";
import { notFound } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

async function shiftIdFrom(context: Context): Promise<ObjectId> {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) throw notFound("That shift");
  return new ObjectId(id);
}

/**
 * `staffId` is how a manager assigns someone directly. When it is absent the
 * action applies to the caller.
 *
 * resolveClaimTarget refuses a staff member passing anyone else's id, so both the
 * self-claim and the manager-assign paths reach the identical claim engine and the
 * business rules cannot diverge between them.
 */
const bodySchema = z
  .object({ staffId: z.string().optional() })
  .optional()
  .default({});

async function readTarget(request: Request) {
  const actor = await requireUser();
  // DELETE requests routinely have no body; treat that as "for myself".
  const body = await readJson(request, bodySchema).catch(() => ({}) as { staffId?: string });
  const targetUser = await resolveClaimTarget(actor, body.staffId);
  return { actor, targetUser };
}

/** POST /api/shifts/:id/claim */
export const POST = handler(async (request: Request, context: Context) => {
  const shiftId = await shiftIdFrom(context);
  const { actor, targetUser } = await readTarget(request);

  const shift = await claimShift({
    shiftId,
    targetUser,
    actorId: new ObjectId(actor.userId),
  });

  return ok({ shift: toShiftView(shift, actor.userId) });
});

/** DELETE /api/shifts/:id/claim */
export const DELETE = handler(async (request: Request, context: Context) => {
  const shiftId = await shiftIdFrom(context);
  const { actor, targetUser } = await readTarget(request);

  const shift = await releaseShift({
    shiftId,
    targetUser,
    actorId: new ObjectId(actor.userId),
  });

  return ok({ shift: toShiftView(shift, actor.userId) });
});
