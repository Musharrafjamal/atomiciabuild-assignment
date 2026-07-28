import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importShiftsCsv, importStaffCsv } from "./run";
import type { ImportRow } from "@/lib/db/schema";
import { clinicDayKey, clinicTimeLabel, durationHours } from "@/lib/time";

/**
 * End-to-end tests against the *actual* files the clinic supplied, not synthetic
 * fixtures. If someone changes a normaliser and a real row starts being handled
 * differently, these fail.
 */

const staffCsv = readFileSync("data/staff.csv", "utf8");
const shiftsCsv = readFileSync("data/shifts.csv", "utf8");

const staff = importStaffCsv(staffCsv);
const shifts = importShiftsCsv(shiftsCsv);

const lineOf = (rows: ImportRow[], line: number) =>
  rows.find((r) => r.rowNumber === line);

describe("importStaffCsv against the provided data/staff.csv", () => {
  it("accounts for every row exactly once", () => {
    expect(staff.summary.total).toBe(41);
    const { accepted, merged, conflict, rejected } = staff.summary;
    expect(accepted + merged + conflict + rejected).toBe(staff.summary.total);
  });

  it("produces the expected split", () => {
    expect(staff.summary).toMatchObject({
      total: 41,
      accepted: 34,
      merged: 2,
      conflict: 2,
      rejected: 3,
    });
  });

  it("imports one record per accepted row", () => {
    expect(staff.records).toHaveLength(staff.summary.accepted);
  });

  it("rejects the janitor rather than assigning a clinical role", () => {
    const row = lineOf(staff.rows, 21); // staff_id 997, Casey Morgan
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("Janitor");
  });

  it("rejects a row with no email, because email is the login", () => {
    const row = lineOf(staff.rows, 28); // staff_id 995, Robin Vale
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("email is empty");
  });

  it("rejects a row with no name", () => {
    const row = lineOf(staff.rows, 39); // staff_id 996
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("full_name is empty");
  });

  it("merges byte-identical duplicate rows and imports them once", () => {
    for (const [dupLine, firstLine] of [
      [22, 20], // staff_id 103, Marcus Kapoor
      [26, 25], // staff_id 110, Felix Volkov
    ]) {
      const row = lineOf(staff.rows, dupLine);
      expect(row?.outcome, `line ${dupLine}`).toBe("merged");
      expect(row?.reason).toContain(`line ${firstLine}`);
    }
    expect(staff.records.filter((r) => r.staffCode === "103")).toHaveLength(1);
    expect(staff.records.filter((r) => r.staffCode === "110")).toHaveLength(1);
  });

  it("reports an email collision between two different staff_ids", () => {
    // 105 Zainab Volkov reuses the address already taken by 999 on line 5
    const row = lineOf(staff.rows, 31);
    expect(row?.outcome).toBe("conflict");
    expect(row?.reason).toContain("already used by staff_id 999");
    expect(row?.action).toContain("line 5");

    // 998 "J. Placeholder" reuses Hiro Iyer's address from line 19
    const placeholder = lineOf(staff.rows, 36);
    expect(placeholder?.outcome).toBe("conflict");
    expect(placeholder?.reason).toContain("already used by staff_id 107");
  });

  it("repairs the (at) addresses and says so in the action", () => {
    const priya = staff.records.find((r) => r.staffCode === "122");
    expect(priya?.email).toBe("priya.weber@clinicmail.test");

    const row = staff.rows.find((r) => r.raw.staff_id === "122");
    expect(row?.outcome).toBe("accepted");
    expect(row?.action).toContain("repaired");
  });

  it("normalises the whitespace-and-caps name", () => {
    const karan = staff.records.find((r) => r.staffCode === "133");
    expect(karan?.name).toBe("Karan Ali"); // from "  Karan ALI"
  });

  it("leaves no duplicate emails or staff codes in the output", () => {
    expect(new Set(staff.records.map((r) => r.email)).size).toBe(
      staff.records.length,
    );
    expect(new Set(staff.records.map((r) => r.staffCode)).size).toBe(
      staff.records.length,
    );
  });

  it("maps every role synonym to one of the three professions", () => {
    for (const record of staff.records) {
      expect(["doctor", "nurse", "receptionist"]).toContain(record.profession);
    }
    // The file's synonyms should yield all three professions.
    expect(new Set(staff.records.map((r) => r.profession)).size).toBe(3);
  });

  it("gives every non-accepted row both a reason and an action", () => {
    for (const row of staff.rows) {
      if (row.outcome === "accepted") continue;
      expect(row.reason.length, `line ${row.rowNumber}`).toBeGreaterThan(0);
      expect(row.action.length, `line ${row.rowNumber}`).toBeGreaterThan(0);
    }
  });
});

describe("importShiftsCsv against the provided data/shifts.csv", () => {
  it("accounts for every row exactly once", () => {
    expect(shifts.summary.total).toBe(117);
    const { accepted, merged, conflict, rejected } = shifts.summary;
    expect(accepted + merged + conflict + rejected).toBe(shifts.summary.total);
  });

  it("produces the expected split", () => {
    expect(shifts.summary).toMatchObject({
      total: 117,
      accepted: 110,
      merged: 1,
      conflict: 0,
      rejected: 6,
    });
  });

  it("records how it resolved each ambiguous date format", () => {
    const notes = shifts.notes.join(" ");
    expect(notes).toContain("day/month/year");
    expect(notes).toContain("29/08/2026");
    expect(notes).toContain("month-day-year");
    expect(notes).toContain("08-13-2026");
  });

  it("rejects 30 February", () => {
    const row = lineOf(shifts.rows, 8); // shift 5110
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("not a real calendar date");
  });

  it("rejects the transposed and the +1 times as implausible durations", () => {
    const transposed = lineOf(shifts.rows, 10); // 5109, 15:00 -> 09:00
    expect(transposed?.outcome).toBe("rejected");
    expect(transposed?.reason).toContain("18 hours");

    const plusOne = lineOf(shifts.rows, 13); // 5115, 08:00 -> 10:00+1
    expect(plusOne?.outcome).toBe("rejected");
    expect(plusOne?.reason).toContain("26 hours");
  });

  it("rejects the zero-length shift with a specific reason", () => {
    const row = lineOf(shifts.rows, 99); // 5112, 12:00 -> 12:00
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("no duration");
  });

  it("rejects the free-text requirements", () => {
    const row = lineOf(shifts.rows, 48); // 5113
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("two nurses and a doctor");
  });

  it("rejects the row with a missing start time", () => {
    const row = lineOf(shifts.rows, 90); // 5114
    expect(row?.outcome).toBe("rejected");
    expect(row?.reason).toContain("start_time is empty");
  });

  it("merges the duplicated shift 5020", () => {
    const row = lineOf(shifts.rows, 33);
    expect(row?.outcome).toBe("merged");
    expect(shifts.records.filter((r) => r.externalId === "5020")).toHaveLength(1);
  });

  it("converts each source date format to the right calendar day", () => {
    const dayOf = (id: string) => {
      const r = shifts.records.find((x) => x.externalId === id)!;
      return clinicDayKey(r.startAt);
    };
    expect(dayOf("5010")).toBe("2026-08-05"); // from "05/08/2026"
    expect(dayOf("5101")).toBe("2026-08-29"); // from "29/08/2026"
    expect(dayOf("5041")).toBe("2026-08-13"); // from "08-13-2026"
    expect(dayOf("5021")).toBe("2026-08-08"); // from "08-08-2026"
    expect(dayOf("5103")).toBe("2026-08-29"); // already ISO
  });

  it("keeps overnight shifts as 8-hour spans on the day they start", () => {
    const night = shifts.records.find((r) => r.externalId === "5103")!; // 22:00-06:00
    expect(clinicTimeLabel(night.startAt)).toBe("22:00");
    expect(clinicTimeLabel(night.endAt)).toBe("06:00");
    expect(durationHours(night.startAt, night.endAt)).toBe(8);
    expect(clinicDayKey(night.startAt)).toBe("2026-08-29");

    const evening = shifts.records.find((r) => r.externalId === "5097")!; // 16:00-00:00
    expect(durationHours(evening.startAt, evening.endAt)).toBe(8);
  });

  /**
   * The strongest single check in this file. The clinic rosters uniform 8-hour
   * shifts, so if the day/month disambiguation or the midnight-crossing rule were
   * wrong, some shifts would come out as 16, 18 or 26 hours. Every accepted shift
   * being exactly 8 hours is independent evidence that the parsing is right.
   */
  it("yields nothing but 8-hour shifts", () => {
    const durations = new Set(
      shifts.records.map((r) => durationHours(r.startAt, r.endAt)),
    );
    expect([...durations]).toEqual([8]);
  });

  it("covers exactly the four-week roster in the file", () => {
    const days = shifts.records.map((r) => clinicDayKey(r.startAt)).sort();
    expect(days[0]).toBe("2026-08-03"); // a Monday
    expect(days[days.length - 1]).toBe("2026-08-30"); // the Sunday four weeks later
  });

  it("leaves no duplicate shift ids in the output", () => {
    expect(new Set(shifts.records.map((r) => r.externalId)).size).toBe(
      shifts.records.length,
    );
  });

  it("gives every non-accepted row both a reason and an action", () => {
    for (const row of shifts.rows) {
      if (row.outcome === "accepted") continue;
      expect(row.reason.length, `line ${row.rowNumber}`).toBeGreaterThan(0);
      expect(row.action.length, `line ${row.rowNumber}`).toBeGreaterThan(0);
    }
  });
});

describe("malformed input", () => {
  it("reports a missing column rather than throwing", () => {
    const result = importStaffCsv("staff_id,full_name\n1,Someone\n");
    expect(result.records).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("missing required column");
  });

  it("handles an empty file", () => {
    const result = importShiftsCsv("");
    expect(result.records).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });

  it("handles a header with no data rows", () => {
    const result = importShiftsCsv(
      "shift_id,date,start_time,end_time,requirements\n",
    );
    expect(result.summary.total).toBe(0);
    expect(result.records).toHaveLength(0);
  });
});
