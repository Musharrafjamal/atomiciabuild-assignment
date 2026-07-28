import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { ObjectId } from "mongodb";
import { closeClient, getDb } from "@/lib/db/client";
import { ensureIndexes } from "@/lib/db/indexes";
import { hashPassword } from "@/lib/auth/password";
import { COLLECTIONS, type UserDoc } from "@/lib/db/schema";
import { importShiftsCsv, importStaffCsv } from "@/lib/import/run";
import {
  IMPORTED_STAFF_PASSWORD,
  persistShiftsImport,
  persistStaffImport,
} from "@/lib/import/persist";

config({ path: ".env.local", quiet: true });

/**
 * Seeds the database by running the *same* import pipeline the manager's CSV
 * upload uses -- the same parsing in src/lib/import/run.ts and the same writing in
 * src/lib/import/persist.ts. Nothing here parses or inserts on its own, so seeded
 * data and uploaded data cannot be treated differently, and the seeded report on
 * the Import page is produced by the code path an upload exercises.
 *
 * Idempotent by default: exits untouched if users already exist, so restarting the
 * stack does not discard work. FORCE_RESEED=true wipes and re-imports.
 */

export const MANAGER_EMAIL = "manager@clinic.test";
const MANAGER_PASSWORD = "manager1234";

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

  // The manager is the one account not present in the spreadsheet.
  await db.collection<UserDoc>(COLLECTIONS.users).insertOne({
    _id: new ObjectId(),
    staffCode: null,
    name: "Clinic Manager",
    email: MANAGER_EMAIL,
    passwordHash: await hashPassword(MANAGER_PASSWORD),
    role: "manager",
    profession: null,
    bookings: [],
    createdAt: new Date(),
  });

  const meta = { source: "seed" as const, uploadedBy: null };

  const staffReport = await persistStaffImport(
    importStaffCsv(readFileSync("data/staff.csv", "utf8")),
    { ...meta, filename: "data/staff.csv" },
  );

  const shiftsReport = await persistShiftsImport(
    importShiftsCsv(readFileSync("data/shifts.csv", "utf8")),
    { ...meta, filename: "data/shifts.csv" },
  );

  const staffCount = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .countDocuments({ role: "staff" });
  const byProfession = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .aggregate<{ _id: string; n: number }>([
      { $match: { role: "staff" } },
      { $group: { _id: "$profession", n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const line = (label: string, s: typeof staffReport.summary) =>
    `  ${label.padEnd(11)} ${s.total} rows -> ${s.accepted} accepted, ${s.merged} merged, ` +
    `${s.conflict} conflict, ${s.rejected} rejected`;

  console.log("\nSeed complete.\n");
  console.log(line("staff.csv", staffReport.summary));
  console.log(line("shifts.csv", shiftsReport.summary));
  console.log(
    `\n  ${staffCount + 1} logins (1 manager, ${staffCount} staff: ` +
      byProfession.map((p) => `${p.n} ${p._id}s`).join(", ") +
      ")",
  );
  console.log(
    `  ${await db.collection(COLLECTIONS.shifts).countDocuments()} shifts\n`,
  );
  console.log(`  Manager:  ${MANAGER_EMAIL} / ${MANAGER_PASSWORD}`);
  console.log(`  Staff:    any imported address / ${IMPORTED_STAFF_PASSWORD}`);
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
