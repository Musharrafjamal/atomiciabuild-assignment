# Clinic Shift Scheduler

A shift scheduling website for a small clinic. Managers create shifts and assign staff;
staff (doctors, nurses, receptionists) claim shifts for themselves. The clinic's old
spreadsheet exports are imported through a validating pipeline that reports on every
row it rejects or merges.

**Live URL:** _pending deployment — see [Deploying](#deploying)._

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16.2 (App Router), React 19, TypeScript | One deployable unit; Route Handlers keep every business rule on the server. |
| Database | MongoDB Atlas (free M0 tier is enough) | A replica set, which is what makes multi-document **transactions** and **change streams** available — the claim engine and live updates depend on them respectively. |
| Data access | Official `mongodb` driver + Zod — no ODM | The concurrency guarantees live inside `findOneAndUpdate` filter predicates; an ODM abstracts exactly that layer. Zod validates both API input and CSV rows. |
| Auth | `bcryptjs` + `jose` JWT in an httpOnly cookie | Small, explicit, no framework coupling. |
| UI | Tailwind CSS v4 + shadcn/ui | Fast path to a polished, responsive interface. |
| CSV | `papaparse` | Tolerates ragged and malformed rows while preserving row numbers for the import report. |
| Tests | Vitest (unit + integration) · Playwright (E2E) | See [Tests](#tests). |

---

## Running locally

```bash
npm install
cp .env.example .env.local    # then fill in MONGODB_URI and AUTH_SECRET
npm run seed                  # imports the CSVs into your database
npm run dev                   # http://localhost:3000
```

`npm run seed` is idempotent — it exits without touching anything if the database
already has data. To wipe and re-import: `FORCE_RESEED=true npm run seed`.

### The one requirement worth knowing

**MongoDB must be a replica set, not a standalone `mongod`.** The claim engine uses
multi-document transactions and live updates use change streams; neither exists on
a standalone server.

Any MongoDB Atlas cluster satisfies this, including the free M0 tier — which is
the intended setup and takes a couple of minutes:

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. Add a database user.
3. Under **Network Access**, allow your IP (and `0.0.0.0/0` if you will deploy to
   Vercel, whose functions have no fixed egress addresses).
4. Copy the connection string into `MONGODB_URI` — **and add a database name to
   the path**. Atlas gives you `…mongodb.net/?appName=…` with no database in it,
   and the driver then quietly defaults to one called `test`.

```
mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/clinic?retryWrites=true&w=majority
```

---

## Deploying

Vercel for the app, MongoDB Atlas for the database.

**1. Create a free M0 cluster** at [cloud.mongodb.com](https://cloud.mongodb.com).
Add a database user, and under *Network Access* allow `0.0.0.0/0` — Vercel's
functions have no fixed egress IPs, so an allow-list of specific addresses will
not work.

**2. Deploy.**

```bash
npx vercel            # link the project
npx vercel --prod
```

**3. Set the environment variables** (Vercel dashboard, or `vercel env add`):

| Variable | Value |
|---|---|
| `MONGODB_URI` | the Atlas SRV string, with a database name — `…mongodb.net/clinic?retryWrites=true&w=majority` |
| `AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CLINIC_TZ` | `Asia/Kolkata` |
| `NEXT_PUBLIC_CLINIC_TZ` | `Asia/Kolkata` — must match `CLINIC_TZ` |

**4. Seed it**, pointing the same script at Atlas:

```bash
MONGODB_URI="<atlas-uri>" FORCE_RESEED=true npm run seed
```

That runs the importer against the provided CSVs, so the deployed site is
populated by exactly the pipeline the app itself uses.

### Cold starts

**Atlas M0 does not sleep** on the timescale of a review — it only pauses after
30 days of zero connections, so the database is warm. Vercel functions do cold
start, so the very first request after a period of inactivity takes roughly a
second; everything after that is warm.

Two M0 limits worth knowing rather than discovering: it throttles at **100
operations/second**, and it is a genuine replica set, which is what allows the
transactions and change streams this app depends on. The dashboard renders a
whole week from a single indexed query specifically to stay well inside that
throttle.

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

One command. It runs 156 unit and integration tests, then 8 end-to-end tests in a
real browser — **164 in total**. Both stages use the `MONGODB_URI` from
`.env.local`; nothing else to set up.

**Neither stage touches your data.** The database name in the connection string is
swapped: integration tests use `clinic_test` and the end-to-end suite uses
`clinic_e2e`, both in the same cluster, and the E2E database is re-seeded from the
provided CSVs before every run so it always starts from a known rota.

Against a remote Atlas cluster the suite takes a few minutes — the concurrency
tests fire many simultaneous claims and each one is a network round trip. That is
worth it: those guarantees are then proved against a real replica set over a real
network, not just a local one.

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

## Features

**Staff** see their week, claim and release shifts. A refusal explains itself
where it happened — *"This overlaps a shift already claimed on 2026-08-17
22:00–06:00"* — rather than as a generic failure.

**Managers** get a coverage board for the week showing every shift, whether it is
fully staffed, short, or empty, and **which roles are still missing**. They can
create, edit and delete shifts, assign staff directly, and import CSVs.

Both stretch goals are implemented:

- **Recurring shifts** — "every Mon/Wed 08:00–16:00 until 30 September". A single
  occurrence can be edited or deleted without disturbing the rest of the series.
- **Live updates** — when a shift fills up, everyone else viewing it sees the
  change without refreshing, typically within 150ms. A badge shows whether the
  board is live or has fallen back to polling.

### Notes on behaviour worth knowing

- **Editing a shift somebody has claimed** shows the manager exactly who would be
  affected and why, and only acts on confirmation. Full reasoning in
  [`DECISIONS.md §5`](./DECISIONS.md).
- **Times are stored as UTC instants** derived from the clinic's timezone
  (`CLINIC_TZ`), so overnight shifts like `22:00 → 06:00` behave correctly and
  overlap detection is exact.
- **Back-to-back shifts are allowed.** `08:00–16:00` followed by `16:00–00:00`
  share an endpoint but do not overlap.

---

## Documentation

- [`DECISIONS.md`](./DECISIONS.md) — the design decisions and their trade-offs:
  how the concurrency guarantees actually work, what happens to existing claims
  when a shift is edited, how the dirty CSVs were interpreted, and what I would
  do differently with more time.
- [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) — the original assignment.

## Project layout

```
src/lib/import/     CSV pipeline — pure, no database, shared by seed and upload
src/lib/rules/      claim engine, shift editing, recurring series
src/lib/db/         driver, schemas, indexes
src/lib/time.ts     clinic-timezone helpers; the only place that knows the zone
src/app/api/        route handlers
src/app/(app)/      authenticated screens
tests/integration/  concurrency and rules, against a real replica set
tests/e2e/          full stack in a browser
```
