import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type ImportReportDoc } from "@/lib/db/schema";
import { handler, ok } from "@/lib/api/respond";
import { toReportDetailView } from "@/lib/api/views";
import { requireManager } from "@/lib/auth/guards";
import { notFound } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

/** GET /api/import/:id — one report with every row. Managers only. */
export const GET = handler(async (_request: Request, context: Context) => {
  await requireManager();
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) throw notFound("That import report");

  const db = await getDb();
  const report = await db
    .collection<ImportReportDoc>(COLLECTIONS.importReports)
    .findOne({ _id: new ObjectId(id) });

  if (!report) throw notFound("That import report");
  return ok({ report: toReportDetailView(report) });
});
