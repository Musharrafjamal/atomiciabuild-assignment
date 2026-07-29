import { z } from "zod";
import { ObjectId } from "mongodb";
import { handler, ok, readJson } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { deleteSeries, updateSeries } from "@/lib/rules/series";
import { clinicToday } from "@/lib/time";
import { notFound } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

async function seriesIdFrom(context: Context): Promise<ObjectId> {
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) throw notFound("That shift series");
  return new ObjectId(id);
}

const updateSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string(),
  endTime: z.string(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requirements: z
    .object({
      doctor: z.number().int().min(0).max(50).optional(),
      nurse: z.number().int().min(0).max(50).optional(),
      receptionist: z.number().int().min(0).max(50).optional(),
    })
    .default({}),
});

/**
 * PATCH /api/series/:id — change the series and reconcile its future
 * occurrences. Detached and claimed occurrences are reported, not overwritten.
 */
export const PATCH = handler(async (request: Request, context: Context) => {
  await requireManager();
  const input = await readJson(request, updateSchema);
  const { result } = await updateSeries(
    await seriesIdFrom(context),
    input,
    clinicToday(),
  );
  return ok(result);
});

/** DELETE /api/series/:id — removes future unclaimed occurrences. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  await requireManager();
  const result = await deleteSeries(await seriesIdFrom(context), clinicToday());
  return ok(result);
});
