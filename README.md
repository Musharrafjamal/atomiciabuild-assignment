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

_Added in §3, once the importer determines the final staff list._

---

## Tests

_Added in §15._

---

## Documentation

- [`DECISIONS.md`](./DECISIONS.md) — design decisions and trade-offs, including what
  happens to existing claims when a shift is edited.
- [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) — the original assignment.
