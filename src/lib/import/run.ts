import Papa from "papaparse";
import type { ImportKind, ImportRow, Profession, StaffCount } from "@/lib/db/schema";
import {
  buildShiftInterval,
  inferDateFormats,
  parseDate,
  parseTime,
} from "./datetime";
import {
  emailNeededRepair,
  normalizeEmail,
  normalizeName,
  normalizeProfession,
  squish,
} from "./normalize";
import { parseRequirements } from "./requirements";

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

export interface ImportedStaff {
  /** Line in the source file, so persistence can annotate the right report row. */
  sourceLine: number;
  staffCode: string;
  name: string;
  email: string;
  profession: Profession;
}

export interface ImportedShift {
  /** Line in the source file, so persistence can annotate the right report row. */
  sourceLine: number;
  externalId: string;
  startAt: Date;
  endAt: Date;
  requirements: StaffCount;
}

export interface ImportSummary {
  total: number;
  accepted: number;
  merged: number;
  conflict: number;
  rejected: number;
}

export interface ImportResult<T> {
  kind: ImportKind;
  summary: ImportSummary;
  /** One entry per data row, in file order. This array *is* the import report. */
  rows: ImportRow[];
  /** The records that should be written to the database. */
  records: T[];
  /**
   * File-level observations -- currently how the ambiguous date formats were
   * resolved. Shown above the per-row table so a reviewer can check the
   * interpretation before trusting the dates.
   */
  notes: string[];
}

function summarise(rows: ImportRow[]): ImportSummary {
  const summary: ImportSummary = {
    total: rows.length,
    accepted: 0,
    merged: 0,
    conflict: 0,
    rejected: 0,
  };
  for (const row of rows) summary[row.outcome] += 1;
  return summary;
}

/* -------------------------------------------------------------------------- */
/* CSV reading                                                                 */
/* -------------------------------------------------------------------------- */

interface RawRow {
  /** Line number in the source file, counting the header as line 1. */
  lineNumber: number;
  values: Record<string, string>;
}

/**
 * Empty lines are *not* skipped during parsing -- they are filtered afterwards --
 * so that the line numbers on the report match what the reviewer sees when they
 * open the file in a spreadsheet.
 */
function readCsv(csvText: string): { header: string[]; rows: RawRow[] } {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: false,
    transformHeader: (h) => squish(h).toLowerCase(),
  });

  const header = parsed.meta.fields ?? [];
  const rows: RawRow[] = [];

  parsed.data.forEach((values, index) => {
    const isBlank = Object.values(values).every((v) => squish(v) === "");
    if (isBlank) return;
    rows.push({ lineNumber: index + 2, values });
  });

  return { header, rows };
}

/** Present the row back to the reviewer exactly as it appeared. */
function rawOf(values: Record<string, string>, columns: string[]) {
  const out: Record<string, string> = {};
  for (const c of columns) out[c] = values[c] ?? "";
  return out;
}

function missingColumns(header: string[], required: string[]): string[] {
  return required.filter((c) => !header.includes(c));
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                       */
/* -------------------------------------------------------------------------- */

const STAFF_COLUMNS = ["staff_id", "full_name", "role", "email"];

export function importStaffCsv(csvText: string): ImportResult<ImportedStaff> {
  const { header, rows } = readCsv(csvText);
  const reportRows: ImportRow[] = [];
  const records: ImportedStaff[] = [];
  const notes: string[] = [];

  const absent = missingColumns(header, STAFF_COLUMNS);
  if (absent.length) {
    return {
      kind: "staff",
      summary: { total: 0, accepted: 0, merged: 0, conflict: 0, rejected: 0 },
      rows: [],
      records: [],
      notes: [
        `file is missing required column(s): ${absent.join(", ")}. Expected: ${STAFF_COLUMNS.join(", ")}.`,
      ],
    };
  }

  // staffCode -> the row that first claimed it; same for email.
  const byCode = new Map<string, { line: number; record: ImportedStaff }>();
  const byEmail = new Map<string, { line: number; code: string }>();

  for (const { lineNumber, values } of rows) {
    const raw = rawOf(values, STAFF_COLUMNS);
    const push = (outcome: ImportRow["outcome"], reason: string, action: string) =>
      reportRows.push({ rowNumber: lineNumber, raw, outcome, reason, action });

    const staffCode = squish(values.staff_id);
    const name = normalizeName(values.full_name ?? "");
    const profession = normalizeProfession(values.role ?? "");
    const email = normalizeEmail(values.email ?? "");

    // Collect every problem in the row rather than stopping at the first, so one
    // pass through the report is enough to fix the row.
    const problems: string[] = [];
    if (!staffCode) problems.push("staff_id is empty");
    if (!name.ok) problems.push(name.reason);
    if (!profession.ok) problems.push(profession.reason);
    if (!email.ok) problems.push(email.reason);

    if (problems.length || !name.ok || !profession.ok || !email.ok) {
      push("rejected", problems.join("; "), "not imported");
      continue;
    }

    const record: ImportedStaff = {
      sourceLine: lineNumber,
      staffCode,
      name: name.value,
      email: email.value,
      profession: profession.value,
    };

    const repaired = emailNeededRepair(values.email ?? "");

    const existingByCode = byCode.get(staffCode);
    if (existingByCode) {
      const identical =
        existingByCode.record.name === record.name &&
        existingByCode.record.email === record.email &&
        existingByCode.record.profession === record.profession;

      if (identical) {
        push(
          "merged",
          `duplicate of line ${existingByCode.line} (same staff_id and identical details)`,
          `merged with line ${existingByCode.line}; imported once`,
        );
      } else {
        push(
          "conflict",
          `staff_id ${staffCode} is already used on line ${existingByCode.line} with different details (${existingByCode.record.name}, ${existingByCode.record.profession}, ${existingByCode.record.email})`,
          `kept the record from line ${existingByCode.line}; this row was not imported`,
        );
      }
      continue;
    }

    const existingByEmail = byEmail.get(record.email);
    if (existingByEmail) {
      push(
        "conflict",
        `email ${record.email} is already used by staff_id ${existingByEmail.code} on line ${existingByEmail.line}, and email is the login identifier so it must be unique`,
        `kept the record from line ${existingByEmail.line}; this row was not imported`,
      );
      continue;
    }

    byCode.set(staffCode, { line: lineNumber, record });
    byEmail.set(record.email, { line: lineNumber, code: staffCode });
    records.push(record);

    push(
      "accepted",
      "",
      repaired
        ? `imported as ${record.name} (${record.profession}); email repaired from "(at)" to "@"`
        : `imported as ${record.name} (${record.profession})`,
    );
  }

  return {
    kind: "staff",
    summary: summarise(reportRows),
    rows: reportRows,
    records,
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Shifts                                                                      */
/* -------------------------------------------------------------------------- */

const SHIFT_COLUMNS = ["shift_id", "date", "start_time", "end_time", "requirements"];

export function importShiftsCsv(csvText: string): ImportResult<ImportedShift> {
  const { header, rows } = readCsv(csvText);
  const reportRows: ImportRow[] = [];
  const records: ImportedShift[] = [];

  const absent = missingColumns(header, SHIFT_COLUMNS);
  if (absent.length) {
    return {
      kind: "shifts",
      summary: { total: 0, accepted: 0, merged: 0, conflict: 0, rejected: 0 },
      rows: [],
      records: [],
      notes: [
        `file is missing required column(s): ${absent.join(", ")}. Expected: ${SHIFT_COLUMNS.join(", ")}.`,
      ],
    };
  }

  // Pass 1: work out what `05/08/2026` means in *this* file before parsing any row.
  const dateProfile = inferDateFormats(rows.map((r) => squish(r.values.date)));
  const notes = [...dateProfile.evidence];

  const byId = new Map<string, { line: number; record: ImportedShift }>();

  // Pass 2: parse each row under the inferred convention.
  for (const { lineNumber, values } of rows) {
    const raw = rawOf(values, SHIFT_COLUMNS);
    const push = (outcome: ImportRow["outcome"], reason: string, action: string) =>
      reportRows.push({ rowNumber: lineNumber, raw, outcome, reason, action });

    const externalId = squish(values.shift_id);
    const date = parseDate(values.date ?? "", dateProfile);
    const start = parseTime(values.start_time ?? "", "start_time");
    const end = parseTime(values.end_time ?? "", "end_time");
    const requirements = parseRequirements(values.requirements ?? "");

    const problems: string[] = [];
    if (!externalId) problems.push("shift_id is empty");
    if (!date.ok) problems.push(date.reason);
    if (!start.ok) problems.push(start.reason);
    if (!end.ok) problems.push(end.reason);
    if (!requirements.ok) problems.push(requirements.reason);

    if (!date.ok || !start.ok || !end.ok || !requirements.ok || !externalId) {
      push("rejected", problems.join("; "), "not imported");
      continue;
    }

    // Times can only be validated against each other once both parse.
    const interval = buildShiftInterval(date.value, start.value, end.value);
    if (!interval.ok) {
      push("rejected", interval.reason, "not imported");
      continue;
    }

    const record: ImportedShift = {
      sourceLine: lineNumber,
      externalId,
      startAt: interval.value.startAt,
      endAt: interval.value.endAt,
      requirements: requirements.value,
    };

    const existing = byId.get(externalId);
    if (existing) {
      const identical =
        existing.record.startAt.getTime() === record.startAt.getTime() &&
        existing.record.endAt.getTime() === record.endAt.getTime() &&
        existing.record.requirements.doctor === record.requirements.doctor &&
        existing.record.requirements.nurse === record.requirements.nurse &&
        existing.record.requirements.receptionist ===
          record.requirements.receptionist;

      if (identical) {
        push(
          "merged",
          `duplicate of line ${existing.line} (same shift_id and identical times and requirements)`,
          `merged with line ${existing.line}; imported once`,
        );
      } else {
        push(
          "conflict",
          `shift_id ${externalId} is already used on line ${existing.line} with different times or requirements`,
          `kept the shift from line ${existing.line}; this row was not imported`,
        );
      }
      continue;
    }

    byId.set(externalId, { line: lineNumber, record });
    records.push(record);

    const overnight = interval.value.crossesMidnight
      ? ", running past midnight into the next day"
      : "";
    push(
      "accepted",
      "",
      `imported as ${date.value} ${squish(values.start_time)}-${squish(values.end_time)}${overnight}`,
    );
  }

  return { kind: "shifts", summary: summarise(reportRows), rows: reportRows, records, notes };
}
