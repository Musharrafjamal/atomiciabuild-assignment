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

---

## Tests

_Added in §15._

---

## Documentation

- [`DECISIONS.md`](./DECISIONS.md) — design decisions and trade-offs, including what
  happens to existing claims when a shift is edited.
- [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) — the original assignment.
