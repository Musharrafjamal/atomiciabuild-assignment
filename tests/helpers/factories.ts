import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db/client";
import { ensureIndexes } from "@/lib/db/indexes";
import {
  COLLECTIONS,
  ZERO_COUNT,
  type Profession,
  type ShiftDoc,
  type StaffCount,
  type UserDoc,
} from "@/lib/db/schema";
import { clinicInstant } from "@/lib/time";

/** Fixtures for integration tests. All times are clinic-local wall clock. */

export async function resetDatabase(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection(COLLECTIONS.users).deleteMany({}),
    db.collection(COLLECTIONS.shifts).deleteMany({}),
    db.collection(COLLECTIONS.importReports).deleteMany({}),
    db.collection(COLLECTIONS.shiftSeries).deleteMany({}),
  ]);
  await ensureIndexes(db);
}

let sequence = 0;

export async function makeUser(
  profession: Profession | null,
  overrides: Partial<UserDoc> = {},
): Promise<UserDoc> {
  const db = await getDb();
  sequence += 1;
  const user: UserDoc = {
    _id: new ObjectId(),
    staffCode: `T${String(sequence).padStart(3, "0")}`,
    name: `Test ${profession ?? "manager"} ${sequence}`,
    email: `test${sequence}@clinic.test`,
    passwordHash: "not-used-in-these-tests",
    role: profession ? "staff" : "manager",
    profession,
    bookings: [],
    createdAt: new Date(),
    ...overrides,
  };
  await db.collection<UserDoc>(COLLECTIONS.users).insertOne(user);
  return user;
}

export async function makeUsers(
  profession: Profession,
  count: number,
): Promise<UserDoc[]> {
  const users: UserDoc[] = [];
  for (let i = 0; i < count; i++) users.push(await makeUser(profession));
  return users;
}

export interface ShiftSpec {
  date?: string;
  start?: string;
  end?: string;
  /** Set when `end` is on the following day, e.g. a 22:00-06:00 night shift. */
  endsNextDay?: boolean;
  requirements?: Partial<StaffCount>;
}

/**
 * Roomy by default so capacity is never the limiting factor unless a test asks
 * for it. Tests about overlap should fail on overlap, not trip over a shift that
 * happens to need nobody.
 */
const GENEROUS: StaffCount = { doctor: 5, nurse: 5, receptionist: 5 };

export async function makeShift(spec: ShiftSpec = {}): Promise<ShiftDoc> {
  const db = await getDb();
  const date = spec.date ?? "2026-08-17";
  const [sh, sm] = (spec.start ?? "08:00").split(":").map(Number);
  const [eh, em] = (spec.end ?? "16:00").split(":").map(Number);

  const shift: ShiftDoc = {
    _id: new ObjectId(),
    externalId: null,
    startAt: clinicInstant(date, { hour: sh, minute: sm }),
    endAt: clinicInstant(date, { hour: eh, minute: em }, spec.endsNextDay ? 1 : 0),
    requirements: spec.requirements
      ? { ...ZERO_COUNT, ...spec.requirements }
      : { ...GENEROUS },
    filled: { ...ZERO_COUNT },
    claims: [],
    seriesId: null,
    occurrenceDate: null,
    detachedFromSeries: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection<ShiftDoc>(COLLECTIONS.shifts).insertOne(shift);
  return shift;
}

export async function readShift(id: ObjectId): Promise<ShiftDoc> {
  const db = await getDb();
  const shift = await db
    .collection<ShiftDoc>(COLLECTIONS.shifts)
    .findOne({ _id: id });
  if (!shift) throw new Error("shift disappeared");
  return shift;
}

export async function readUser(id: ObjectId): Promise<UserDoc> {
  const db = await getDb();
  const user = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .findOne({ _id: id });
  if (!user) throw new Error("user disappeared");
  return user;
}

/**
 * Run `fn` for each item as simultaneously as the runtime allows, and report which
 * settled how. Returns rejection *reasons* rather than throwing, because these
 * tests are about how many operations are refused and why.
 */
export async function raceAll<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<{ fulfilled: Awaited<R>[]; rejected: unknown[] }> {
  const settled = await Promise.allSettled(items.map((item) => fn(item)));
  const fulfilled: Awaited<R>[] = [];
  const rejected: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") fulfilled.push(result.value);
    else rejected.push(result.reason);
  }
  return { fulfilled, rejected };
}
