import type { Db } from "mongodb";
import { COLLECTIONS } from "./schema";

/**
 * Idempotent index creation. `createIndex` is a no-op when an identical index
 * already exists, so this is safe to run on every boot and from the seed.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // Email is the login identifier. The unique constraint is also the last line
    // of defence for the importer's email-collision handling: even if two rows
    // slipped through validation, the database would reject the second.
    db
      .collection(COLLECTIONS.users)
      .createIndex({ email: 1 }, { unique: true, name: "uniq_email" }),

    // Staff codes come from the CSV and are unique per person, but the manager
    // login we create has none -- hence a sparse unique index.
    db
      .collection(COLLECTIONS.users)
      .createIndex(
        { staffCode: 1 },
        { unique: true, sparse: true, name: "uniq_staffCode" },
      ),

    // The dashboard queries one week at a time: startAt within [monday, nextMonday).
    db
      .collection(COLLECTIONS.shifts)
      .createIndex({ startAt: 1 }, { name: "shift_startAt" }),

    // Overlap re-validation on shift edit scans a claimer's other shifts by time.
    db
      .collection(COLLECTIONS.shifts)
      .createIndex({ "claims.userId": 1, startAt: 1 }, { name: "shift_claimant" }),

    // Series regeneration and single-occurrence edits look up by series.
    db
      .collection(COLLECTIONS.shifts)
      .createIndex(
        { seriesId: 1, occurrenceDate: 1 },
        { sparse: true, name: "shift_series" },
      ),

    // Import report list is newest-first.
    db
      .collection(COLLECTIONS.importReports)
      .createIndex({ createdAt: -1 }, { name: "report_recent" }),
  ]);
}
