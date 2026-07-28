import { z } from "zod";
import { ObjectId } from "mongodb";
import { handler, ok, readJson } from "@/lib/api/respond";
import { toShiftView } from "@/lib/api/views";
import { requireManager } from "@/lib/auth/guards";
import { applyShiftEdit, deleteShift, previewShiftEdit } from "@/lib/rules/shifts";
import { notFound } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

async function shiftIdFrom(context: Context): Promise<ObjectId> {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) throw notFound("That shift");
  return new ObjectId(id);
}

const editSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  startTime: z.string(),
  endTime: z.string(),
  requirements: z
    .object({
      doctor: z.number().int().min(0).max(50).optional(),
      nurse: z.number().int().min(0).max(50).optional(),
      receptionist: z.number().int().min(0).max(50).optional(),
    })
    .default({}),
  /**
   * When true, nothing is written -- the response reports which claims the edit
   * would invalidate so the manager can confirm. See DECISIONS.md §5.
   */
  preview: z.boolean().optional(),
  /** The `updatedAt` the preview was computed against. */
  expectedUpdatedAt: z.string().optional(),
});

/** PATCH /api/shifts/:id — preview or apply an edit. Managers only. */
export const PATCH = handler(async (request: Request, context: Context) => {
  await requireManager();
  const shiftId = await shiftIdFrom(context);
  const input = await readJson(request, editSchema);

  if (input.preview) {
    const preview = await previewShiftEdit(shiftId, input);
    return ok({
      preview: true,
      conflicts: preview.conflicts,
      expectedUpdatedAt: preview.expectedUpdatedAt,
      shift: toShiftView(preview.shift),
    });
  }

  const { shift, released } = await applyShiftEdit(
    shiftId,
    input,
    input.expectedUpdatedAt,
  );
  return ok({ shift: toShiftView(shift), released });
});

/** DELETE /api/shifts/:id — releases every claim as part of the same transaction. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  await requireManager();
  await deleteShift(await shiftIdFrom(context));
  return ok({ ok: true });
});
