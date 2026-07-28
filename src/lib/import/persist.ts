import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import {
  COLLECTIONS,
  ZERO_COUNT,
  type ImportReportDoc,
  type ImportRow,
  type ShiftDoc,
  type UserDoc,
} from "@/lib/db/schema";
import type { ImportResult, ImportedShift, ImportedStaff } from "./run";

/**
 * Writes the records an import produced, and amends the report to say what
 * actually reached the database.
 *
 * Import is **additive**. A record whose identifier already exists is skipped and
 * reported, rather than overwriting. For shifts this is the safe choice by some
 * distance: silently rewriting the times of a shift people have already claimed
 * would invalidate their claims without the re-validation and disclosure that the
 * edit flow gives them (see DECISIONS.md §5). Managers who want to change a shift
 * have a UI that does it properly.
 *
 * Skipped rows are marked `conflict` with a reason naming the existing record, so
 * the report distinguishes "this clashed with another row in your file" from
 * "this is already in the system".
 */

export const IMPORTED_STAFF_PASSWORD = "staff1234";

/** Flip an accepted row to a conflict because the database already had it. */
function markSkipped(rows: ImportRow[], line: number, reason: string) {
  const row = rows.find((r) => r.rowNumber === line);
  if (!row) return;
  row.outcome = "conflict";
  row.reason = reason;
  row.action = "not imported; the existing record was left unchanged";
}

function resummarise(report: { rows: ImportRow[] }) {
  const summary = {
    total: report.rows.length,
    accepted: 0,
    merged: 0,
    conflict: 0,
    rejected: 0,
  };
  for (const row of report.rows) summary[row.outcome] += 1;
  return summary;
}

export async function persistStaffImport(
  result: ImportResult<ImportedStaff>,
  meta: { source: "seed" | "upload"; filename: string; uploadedBy: ObjectId | null },
): Promise<ImportReportDoc> {
  const db = await getDb();
  const users = db.collection<UserDoc>(COLLECTIONS.users);
  const rows = result.rows.map((r) => ({ ...r }));

  // One lookup for the whole file rather than one per row.
  const existing = await users
    .find(
      {
        $or: [
          { email: { $in: result.records.map((r) => r.email) } },
          { staffCode: { $in: result.records.map((r) => r.staffCode) } },
        ],
      },
      { projection: { email: 1, staffCode: 1, name: 1 } },
    )
    .toArray();

  const byEmail = new Map(existing.map((u) => [u.email, u]));
  const byCode = new Map(existing.map((u) => [u.staffCode, u]));

  const toInsert: UserDoc[] = [];
  const now = new Date();

  for (const record of result.records) {
    const clashEmail = byEmail.get(record.email);
    const clashCode = byCode.get(record.staffCode);

    if (clashEmail) {
      markSkipped(
        rows,
        record.sourceLine,
        `${record.email} is already registered to ${clashEmail.name}`,
      );
      continue;
    }
    if (clashCode) {
      markSkipped(
        rows,
        record.sourceLine,
        `staff_id ${record.staffCode} already belongs to ${clashCode.name}`,
      );
      continue;
    }

    toInsert.push({
      _id: new ObjectId(),
      staffCode: record.staffCode,
      name: record.name,
      email: record.email,
      passwordHash: await hashPassword(IMPORTED_STAFF_PASSWORD),
      role: "staff",
      profession: record.profession,
      bookings: [],
      createdAt: now,
    });

    // Guard against the same file listing one address twice in ways the in-file
    // dedup did not catch.
    byEmail.set(record.email, { ...toInsert[toInsert.length - 1] });
    byCode.set(record.staffCode, { ...toInsert[toInsert.length - 1] });
  }

  if (toInsert.length) await users.insertMany(toInsert);

  return writeReport(db, {
    ...meta,
    kind: "staff",
    rows,
    notes: result.notes,
  });
}

export async function persistShiftsImport(
  result: ImportResult<ImportedShift>,
  meta: { source: "seed" | "upload"; filename: string; uploadedBy: ObjectId | null },
): Promise<ImportReportDoc> {
  const db = await getDb();
  const shifts = db.collection<ShiftDoc>(COLLECTIONS.shifts);
  const rows = result.rows.map((r) => ({ ...r }));

  const existing = await shifts
    .find(
      { externalId: { $in: result.records.map((r) => r.externalId) } },
      { projection: { externalId: 1, startAt: 1 } },
    )
    .toArray();
  const known = new Set(existing.map((s) => s.externalId));

  const now = new Date();
  const toInsert: ShiftDoc[] = [];

  for (const record of result.records) {
    if (known.has(record.externalId)) {
      markSkipped(
        rows,
        record.sourceLine,
        `shift_id ${record.externalId} is already in the schedule; existing shifts are not overwritten by import because that would invalidate claims without warning`,
      );
      continue;
    }
    known.add(record.externalId);

    toInsert.push({
      _id: new ObjectId(),
      externalId: record.externalId,
      startAt: record.startAt,
      endAt: record.endAt,
      requirements: record.requirements,
      filled: { ...ZERO_COUNT },
      claims: [],
      seriesId: null,
      occurrenceDate: null,
      detachedFromSeries: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length) await shifts.insertMany(toInsert);

  return writeReport(db, {
    ...meta,
    kind: "shifts",
    rows,
    notes: result.notes,
  });
}

async function writeReport(
  db: Awaited<ReturnType<typeof getDb>>,
  input: {
    source: "seed" | "upload";
    kind: "staff" | "shifts";
    filename: string;
    uploadedBy: ObjectId | null;
    rows: ImportRow[];
    notes: string[];
  },
): Promise<ImportReportDoc> {
  const report: ImportReportDoc = {
    _id: new ObjectId(),
    createdAt: new Date(),
    source: input.source,
    kind: input.kind,
    filename: input.filename,
    summary: resummarise({ rows: input.rows }),
    rows: input.rows,
    notes: input.notes,
    uploadedBy: input.uploadedBy,
  };

  await db
    .collection<ImportReportDoc>(COLLECTIONS.importReports)
    .insertOne(report);
  return report;
}

/** Decide from the header row which kind of file this is. */
export function detectImportKind(csvText: string): "staff" | "shifts" | null {
  const header = (csvText.split(/\r?\n/, 1)[0] ?? "").toLowerCase();
  if (header.includes("staff_id")) return "staff";
  if (header.includes("shift_id")) return "shifts";
  return null;
}
