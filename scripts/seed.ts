import { readFileSync } from "node:fs";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { closeClient, getDb } from "@/lib/db/client";
import { ensureIndexes } from "@/lib/db/indexes";
import {
  COLLECTIONS,
  ZERO_COUNT,
  type ImportReportDoc,
  type ShiftDoc,
  type UserDoc,
} from "@/lib/db/schema";
import { importShiftsCsv, importStaffCsv, type ImportResult } from "@/lib/import/run";

config({ path: ".env.local", quiet: true });

/**
 * Seeds the database by running the *same* import pipeline the manager's CSV
 * upload uses. Nothing here parses CSV itself, so the seeded data and an uploaded
 * file are guaranteed to be treated identically.
 *
 * Idempotent by default: if the database already has users it exits without
 * touching anything, so restarting the stack does not discard work in progress.
 * Set FORCE_RESEED=true to wipe and re-import.
 */

/** Dev credentials. Documented in the README; not secrets. */
export const MANAGER_EMAIL = "manager@clinic.test";
const MANAGER_PASSWORD = "manager1234";
const STAFF_PASSWORD = "staff1234";
const BCRYPT_COST = 10;

async function main() {
  const force = process.env.FORCE_RESEED === "true";
  const db = await getDb();

  const existing = await db.collection(COLLECTIONS.users).countDocuments();
  if (existing > 0 && !force) {
    console.log(
      `Database already seeded (${existing} users). Set FORCE_RESEED=true to wipe and re-import.`,
    );
    return;
  }

  if (existing > 0) {
    console.log("FORCE_RESEED set -- clearing existing data");
    await Promise.all([
      db.collection(COLLECTIONS.users).deleteMany({}),
      db.collection(COLLECTIONS.shifts).deleteMany({}),
      db.collection(COLLECTIONS.importReports).deleteMany({}),
      db.collection(COLLECTIONS.shiftSeries).deleteMany({}),
    ]);
  }

  await ensureIndexes(db);

  const staffCsv = readFileSync("data/staff.csv", "utf8");
  const shiftsCsv = readFileSync("data/shifts.csv", "utf8");

  const staffResult = importStaffCsv(staffCsv);
  const shiftsResult = importShiftsCsv(shiftsCsv);

  const now = new Date();

  /* -- users ------------------------------------------------------------- */

  const managerHash = await bcrypt.hash(MANAGER_PASSWORD, BCRYPT_COST);
  const users: UserDoc[] = [
    {
      _id: new ObjectId(),
      staffCode: null,
      name: "Clinic Manager",
      email: MANAGER_EMAIL,
      passwordHash: managerHash,
      role: "manager",
      profession: null,
      bookings: [],
      createdAt: now,
    },
  ];

  // Hashed per user rather than once and reused, so no two accounts share a salt.
  for (const record of staffResult.records) {
    users.push({
      _id: new ObjectId(),
      staffCode: record.staffCode,
      name: record.name,
      email: record.email,
      passwordHash: await bcrypt.hash(STAFF_PASSWORD, BCRYPT_COST),
      role: "staff",
      profession: record.profession,
      bookings: [],
      createdAt: now,
    });
  }

  await db.collection<UserDoc>(COLLECTIONS.users).insertMany(users);

  /* -- shifts ------------------------------------------------------------ */

  const shifts: ShiftDoc[] = shiftsResult.records.map((record) => ({
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
  }));

  if (shifts.length) {
    await db.collection<ShiftDoc>(COLLECTIONS.shifts).insertMany(shifts);
  }

  /* -- import reports ---------------------------------------------------- */

  const toReport = (
    result: ImportResult<unknown>,
    filename: string,
  ): ImportReportDoc => ({
    _id: new ObjectId(),
    createdAt: now,
    source: "seed",
    kind: result.kind,
    filename,
    summary: result.summary,
    rows: result.rows,
    notes: result.notes,
    uploadedBy: null,
  });

  await db
    .collection<ImportReportDoc>(COLLECTIONS.importReports)
    .insertMany([
      toReport(staffResult, "data/staff.csv"),
      toReport(shiftsResult, "data/shifts.csv"),
    ]);

  /* -- summary ----------------------------------------------------------- */

  const byProfession = staffResult.records.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.profession]: (acc[r.profession] ?? 0) + 1 }),
    {},
  );

  console.log("\nSeed complete.\n");
  console.log(
    `  staff.csv   ${staffResult.summary.total} rows -> ${staffResult.summary.accepted} accepted, ` +
      `${staffResult.summary.merged} merged, ${staffResult.summary.conflict} conflict, ` +
      `${staffResult.summary.rejected} rejected`,
  );
  console.log(
    `  shifts.csv  ${shiftsResult.summary.total} rows -> ${shiftsResult.summary.accepted} accepted, ` +
      `${shiftsResult.summary.merged} merged, ${shiftsResult.summary.conflict} conflict, ` +
      `${shiftsResult.summary.rejected} rejected`,
  );
  console.log(
    `\n  ${users.length} logins (1 manager, ${staffResult.records.length} staff: ` +
      `${byProfession.doctor ?? 0} doctors, ${byProfession.nurse ?? 0} nurses, ` +
      `${byProfession.receptionist ?? 0} receptionists)`,
  );
  console.log(`  ${shifts.length} shifts\n`);
  console.log(`  Manager:  ${MANAGER_EMAIL} / ${MANAGER_PASSWORD}`);
  const sample = staffResult.records[0];
  if (sample) console.log(`  Staff:    ${sample.email} / ${STAFF_PASSWORD}`);
  console.log("\n  Full credentials are in the README.\n");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeClient();
  });
