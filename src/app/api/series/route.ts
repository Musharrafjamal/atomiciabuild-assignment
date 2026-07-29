import { z } from "zod";
import { handler, ok, readJson } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { createSeries } from "@/lib/rules/series";

const seriesSchema = z.object({
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

/** POST /api/series — create a recurring shift and materialise its occurrences. */
export const POST = handler(async (request: Request) => {
  await requireManager();
  const input = await readJson(request, seriesSchema);
  const { series, created } = await createSeries(input);

  return ok(
    { seriesId: series._id.toHexString(), created },
    201,
  );
});
