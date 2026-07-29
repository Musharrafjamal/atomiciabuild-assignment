# Clinic Shift Scheduler

A shift scheduling website for a small clinic. Managers create shifts and assign staff;
staff (doctors, nurses, receptionists) claim shifts for themselves. The clinic's old
spreadsheet exports are imported through a validating pipeline that reports on every
row it rejects or merges.

**Live URL:** _added in §12_

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16.2 (App Router), React 19, TypeScript | One deployable unit; Route Handlers keep every business rule on the server. |
| Database | MongoDB — Atlas M0 in production, `mongodb/mongodb-atlas-local` in Docker | Both are replica sets, so multi-document **transactions** and **change streams** behave identically in development and production. |
| Data access | Official `mongodb` driver + Zod — no ODM | The concurrency guarantees live inside `findOneAndUpdate` filter predicates; an ODM abstracts exactly that layer. Zod validates both API input and CSV rows. |
| Auth | `bcryptjs` + `jose` JWT in an httpOnly cookie | Small, explicit, no framework coupling. |
| UI | Tailwind CSS v4 + shadcn/ui | Fast path to a polished, responsive interface. |
| CSV | `papaparse` | Tolerates ragged and malformed rows while preserving row numbers for the import report. |
| Tests | Vitest (unit + integration) · Playwright (E2E) | See [Tests](#tests). |

---

## Running locally

One command, no prior setup beyond Docker:

```bash
docker compose up
```

This starts MongoDB as a single-node replica set, waits for it to elect a primary,
runs the CSV import to seed the database, and serves the app at
**http://localhost:3000**.

To wipe and re-import: `FORCE_RESEED=true docker compose up`.

<details>
<summary>Running without Docker</summary>

Requires a MongoDB **replica set** (not a standalone `mongod` — transactions and
change streams both need one).

```bash
cp .env.example .env.local   # then point MONGODB_URI at your replica set
npm install
npm run seed
npm run dev
```
</details>

---

## Seeded logins

The staff roster is produced by importing `data/staff.csv` — these accounts are
whatever the importer accepted, not a hand-written list.

**Manager** — `manager@clinic.test` / `manager1234`

**All staff share the password `staff1234`.** Sign in with any address below.

<details open>
<summary><strong>Doctors</strong> (8)</summary>

| Name | Email |
|---|---|
| Chloe Hussain | `chloe.hussain@clinicmail.test` |
| Dev Bell | `dev.bell@clinicmail.test` |
| Hiro Nolan | `hiro.nolan@clinicmail.test` |
| Lucia Volkov | `lucia.volkov@clinicmail.test` |
| Marcus Whitfield | `marcus.whitfield@clinicmail.test` |
| Omar Patel | `omar.patel@clinicmail.test` |
| Priya Weber | `priya.weber@clinicmail.test` |
| Rosa Patel | `rosa.patel@clinicmail.test` |
</details>

<details>
<summary><strong>Nurses</strong> (16)</summary>

| Name | Email |
|---|---|
| Aisha Sharma | `aisha.sharma@clinicmail.test` |
| Aisha Weber | `aisha.weber@clinicmail.test` |
| Anya Haddad | `anya.haddad@clinicmail.test` |
| Ben Ali | `ben.ali@clinicmail.test` |
| Fatima Petrova | `fatima.petrova@clinicmail.test` |
| Felix Volkov | `felix.volkov@clinicmail.test` |
| Ivy Bell | `ivy.bell@clinicmail.test` |
| Noah Ali | `noah.ali@clinicmail.test` |
| Omar Haddad | `omar.haddad@clinicmail.test` |
| Priya Lind | `priya.lind@clinicmail.test` |
| Priya Patel | `priya.patel@clinicmail.test` |
| Rosa Weber | `rosa.weber@clinicmail.test` |
| Tara Rahman | `tara.rahman@clinicmail.test` |
| Tara Rossi | `tara.rossi@clinicmail.test` |
| Yusuf Patel | `yusuf.patel@clinicmail.test` |
| Zainab Volkov | `zainab.volkov@clinicmail.test` |
</details>

<details>
<summary><strong>Receptionists</strong> (10)</summary>

| Name | Email |
|---|---|
| Anya Nakamura | `anya.nakamura@clinicmail.test` |
| Ben Marchand | `ben.marchand@clinicmail.test` |
| Fatima Marchand | `fatima.marchand@clinicmail.test` |
| Hiro Iyer | `hiro.iyer@clinicmail.test` |
| Hiro Petrova | `hiro.petrova@clinicmail.test` |
| Karan Ali | `karan.ali@clinicmail.test` |
| Lucia Nakamura | `lucia.nakamura@clinicmail.test` |
| Marcus Kapoor | `marcus.kapoor@clinicmail.test` |
| Priya Mehta | `priya.mehta@clinicmail.test` |
| Zainab Okafor | `zainab.okafor@clinicmail.test` |
</details>

> Some names from the spreadsheet are deliberately absent — Casey Morgan (listed as
> a janitor), Robin Vale (no email), and the row with no name were all rejected by
> the importer. The **Import** page in the app explains each one.

### What the seed imports

| File | Rows | Accepted | Merged | Conflict | Rejected |
|---|---|---|---|---|---|
| `data/staff.csv` | 41 | 34 | 2 | 2 | 3 |
| `data/shifts.csv` | 117 | 110 | 1 | 0 | 6 |

Every non-accepted row is explained on the Import Report page, with the original
row, what was wrong with it, and what was done about it.

The seed then places **157 claims** across the 110 shifts, leaving 28 fully
staffed, 46 short, and 36 with nobody on them — so the coverage dashboard shows
all three states rather than a wall of empty ones.

Those claims go through the real claim engine rather than being inserted
directly, so the fill counters, the denormalised bookings and the overlap rule
are all consistent, and the seeded state is one the application could genuinely
have reached. The placement is deterministic: the same CSVs always produce the
same rota.

---

## Tests

```bash
npm test
```

One command. It runs 149 unit and integration tests, then 8 end-to-end tests in a
real browser — **157 in total**. Both stages need the Docker MongoDB running
(`docker compose up -d mongo`); nothing else.

Neither stage touches the development database. Unit and integration tests use
`clinic_test`; the end-to-end suite gets `clinic_e2e`, re-seeded from the provided
CSVs before every run so it always starts from a known rota.

<details>
<summary>Running a stage on its own</summary>

```bash
npm run test:unit      # vitest: parsers, rules, concurrency
npm run test:e2e       # playwright: full stack in a browser
npm run test:watch     # vitest in watch mode
npm run check          # typecheck + lint
```

The first `npm run test:e2e` needs browsers: `npx playwright install chromium`.
</details>

### What is actually covered

| | |
|---|---|
| **Parsing** | Every normaliser against the *real* garbage in the supplied CSVs — `2026-02-30`, `08-13-2026`, `10:00+1`, `12:00→12:00`, `(at)` addresses, duplicate rows, `two nurses and a doctor`. |
| **Concurrency** | 8 nurses racing one slot; 12 racing three; one person firing five overlapping claims at once; interleaved claim/release. Run against a real replica set, not a mock. |
| **Shift editing** | Claim re-validation, the preview-then-confirm flow, stale-preview rejection, and that a moved shift takes its claimants' bookings with it. |
| **Recurring shifts** | Per-occurrence edit and delete surviving a series change, and a series spanning the October DST boundary. |
| **End-to-end** | Sign-in for both roles, claiming, the overlap refusal appearing on screen with its reason, staff being refused manager screens *and* manager APIs, assignment updating the board, the edit warning, and the import report. |

Two scripts verify things a unit test cannot:

```bash
npx tsx scripts/responsive-check.ts   # no horizontal overflow at 375 / 768 / 1440
npx tsx scripts/live-check.ts         # live updates across two real sessions
```

---

## Documentation

- [`DECISIONS.md`](./DECISIONS.md) — design decisions and trade-offs, including what
  happens to existing claims when a shift is edited.
- [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) — the original assignment.
