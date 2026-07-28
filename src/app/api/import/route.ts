import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db/client";
import { COLLECTIONS, type ImportReportDoc } from "@/lib/db/schema";
import { handler, ok } from "@/lib/api/respond";
import { toReportSummaryView } from "@/lib/api/views";
import { requireManager } from "@/lib/auth/guards";
import { invalidInput } from "@/lib/errors";
import { importShiftsCsv, importStaffCsv } from "@/lib/import/run";
import {
  detectImportKind,
  persistShiftsImport,
  persistStaffImport,
} from "@/lib/import/persist";

/** 2 MB is far more than the clinic's exports need and keeps a bad upload cheap. */
const MAX_BYTES = 2 * 1024 * 1024;

/** GET /api/import — every report, newest first. Managers only. */
export const GET = handler(async () => {
  await requireManager();
  const db = await getDb();

  const reports = await db
    .collection<ImportReportDoc>(COLLECTIONS.importReports)
    .find({}, { projection: { rows: 0, notes: 0 }, sort: { createdAt: -1 } })
    .toArray();

  return ok({ reports: reports.map(toReportSummaryView) });
});

/**
 * POST /api/import — upload a CSV.
 *
 * Runs the identical pipeline the seed uses; the only thing this adds is reading
 * the upload and writing the results. The file kind is detected from the header so
 * the manager just picks a file.
 */
export const POST = handler(async (request: Request) => {
  const manager = await requireManager();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    throw invalidInput("Choose a CSV file to import.");
  }
  if (file.size === 0) {
    throw invalidInput("That file is empty.");
  }
  if (file.size > MAX_BYTES) {
    throw invalidInput("That file is larger than the 2 MB limit.");
  }

  const csvText = await file.text();
  const kind = detectImportKind(csvText);

  if (!kind) {
    throw invalidInput(
      "Could not tell what this file contains. A staff file needs a staff_id column; a shifts file needs a shift_id column.",
    );
  }

  const meta = {
    source: "upload" as const,
    filename: file.name || "upload.csv",
    uploadedBy: new ObjectId(manager.userId),
  };

  const report =
    kind === "staff"
      ? await persistStaffImport(importStaffCsv(csvText), meta)
      : await persistShiftsImport(importShiftsCsv(csvText), meta);

  return ok({ report: toReportSummaryView(report) }, 201);
});
