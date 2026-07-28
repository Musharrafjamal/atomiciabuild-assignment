# Design decisions

Written as each decision was made, not reconstructed afterwards. Each section names
the alternative that was rejected and why.

---

## 1. Storage and modelling

### Times are stored as UTC instants, not date + time strings

The provided `shifts.csv` is full of shifts that cross midnight — `22:00 → 06:00`,
`16:00 → 00:00`, and one written as `08:00 → 10:00+1`. Keeping `date`, `start_time`
and `end_time` as separate fields would make "does A overlap B?" a comparison
involving string parsing and a special case for wrap-around, which is where this
kind of bug lives.

Instead each shift stores `startAt` and `endAt` as UTC `Date`s, computed from the
clinic-local wall clock at import time. Overlap then reduces to
`aStart < bEnd && aEnd > bStart`, which is correct for overnight shifts with no
special casing.

The comparison is deliberately **half-open**. Back-to-back shifts (`08:00–16:00`
then `16:00–00:00`) share an endpoint, and a nurse may legitimately work both; a
closed-interval test would reject the second claim. This is covered by a test.

The clinic's timezone is configuration (`CLINIC_TZ`, default `Europe/London`) rather
than a hardcoded offset, so BST/GMT transitions are handled by the timezone database.
Tests assert both a summer and a winter date, and that a week spanning the October
DST change still contains exactly seven distinct days.

### Claims are embedded in the shift document

A shift needs at most a handful of people, so `claims` is a bounded array on the
shift rather than a separate collection. This buys two things:

1. The coverage dashboard renders a week from **one** query — no join, no N+1. That
   matters on Atlas M0, which throttles at 100 operations/second.
2. Capacity becomes a property of a single document, so it can be enforced by a
   single atomic update rather than a read-modify-write. See §4.

A denormalised `filled` counter sits next to `requirements` so the capacity check is
a numeric comparison the database can evaluate inside the update predicate. It is
only ever mutated in the same transaction as `claims`, so the two cannot drift.

### No ODM

The correctness guarantees in §4 live inside `findOneAndUpdate` filter predicates —
`$expr`, `$elemMatch`, `$not`. An ODM abstracts precisely that layer, and working
around it costs more than it saves. The official driver is used directly, with Zod
providing schema validation at both the API boundary and the CSV boundary.

## 2. Reading the dirty CSVs

The importer is a pure module (`src/lib/import/`) with no database or framework
imports. The seed and the manager's UI upload both call the same functions, which
is why an uploaded file produces a report identical in form to the seeded one.

Every row produces `{ rowNumber, raw, outcome, reason, action }`. That array **is**
the import report — there is no second code path that summarises what happened, so
the report cannot drift from what was actually done.

Line numbers count the header as line 1, so they match what the reviewer sees when
opening the CSV in a spreadsheet. Blank lines are filtered *after* parsing rather
than skipped during it, so the numbering stays true.

### Date formats are inferred from the file, not assumed

The export mixes three date formats, and `05/08/2026` is ambiguous in isolation —
5 August or 8 May?

Rather than hardcode a convention, the importer reads all the dates first and
derives one: if any row has a first component above 12, the first component must be
the day, and that convention then applies to the whole file. In the supplied data
`29/08/2026` proves slash dates are day-first, and `08-13-2026` proves dash dates
are month-first. Both conclusions are printed at the top of the import report with
the row that proved them, so the interpretation can be checked rather than trusted.

If a file never disambiguates, day-first is assumed and the report says so
explicitly. If a file contradicts itself, that is reported too.

**Independent confirmation this is right:** the clinic rosters uniform 8-hour
shifts, and all 110 accepted shifts come out at exactly 8 hours. A wrong day/month
reading or a broken midnight rule would produce 16-, 18- or 26-hour outliers. There
is a test asserting the set of distinct durations is exactly `[8]`.

### What counts as an impossible time

- **End at or before start** is read as crossing midnight, which is what makes
  `22:00 → 06:00` and `16:00 → 00:00` come out as 8-hour shifts rather than
  negative ones.
- **Identical start and end** (`12:00 → 12:00`, shift 5112) is reported as a
  zero-duration shift. Under the midnight rule it would technically be a 24-hour
  shift, but that diagnosis would be useless to whoever has to fix the row.
- **Anything over 16 hours** is rejected as a data-entry error. Every well-formed
  shift in the file is 8 hours; 16 permits a legitimate double shift while still
  catching `15:00 → 09:00` (18h, transposed) and `08:00 → 10:00+1` (26h).

### Rejected rather than guessed

Two places where a cleverer importer would have been a worse one:

- **`two nurses and a doctor`** (shift 5113) is rejected, not parsed. Handling
  English number words would work for this row and then quietly mis-staff a shift
  the first time someone writes "a couple of nurses". Rostering the wrong number of
  clinical staff is worse than refusing the row and naming it on the report.
- **`Janitor`** (staff 997) is rejected rather than fuzzy-matched to a clinical
  role. Role mapping is exact-match against a synonym table for the same reason.

The one repair that *is* applied automatically is `(at)` → `@` in email addresses,
because `(at)` cannot legally appear in an address, so the substitution is
unambiguous. The report still says the address was repaired.

### Merge, conflict and reject are distinguished

- **merged** — a later row is byte-identical to an earlier one after normalisation
  (staff 103 and 110, shift 5020). Imported once, both lines shown.
- **conflict** — a later row reuses an identifier with *different* data. The first
  occurrence wins and the report names the line that was kept. This covers the two
  email collisions: staff 105 reuses the address of 999, and "J. Placeholder" (998)
  reuses Hiro Iyer's.
- **rejected** — the row is unusable on its own terms (bad date, no email, no name,
  unparseable requirements).

Keep-first is deliberate over anything cleverer. The IDs in the 995–999 range are
obviously junk in *this* file, but a rule like "prefer lower ids" would be
overfitting — the same importer has to handle an arbitrary CSV uploaded through the
UI. Predictable behaviour plus a report that names the clash lets a human resolve it.

A row missing several things reports all of them at once, so one pass through the
report is enough to fix it.

## 3. Authentication

### A hand-rolled session rather than Auth.js

Sessions are a `jose`-signed JWT in an httpOnly cookie, with `bcryptjs` for password
hashing — about 120 lines in total.

Auth.js would have been the conventional pick, but its Credentials provider plus
middleware integration is a well-known source of configuration friction, and on a
four-day budget the risk of losing half a day to it outweighed the benefit. What
this app actually needs from auth is small and completely specified: verify a
password, issue a signed token, read it back, and know a role. Owning that
outright also means every line is explainable, which the brief explicitly asks for.

`bcryptjs` over the native `bcrypt` binding so there is no compilation step in the
Docker image and the same code runs unchanged on Vercel.

### The proxy is not the security boundary

`src/proxy.ts` redirects signed-out visitors to the login page and keeps staff off
manager screens. That is a convenience, not a control — Next's own documentation
states Proxy should not be used as an authorisation solution.

The real boundary is `requireUser()` / `requireManager()` in `src/lib/auth/guards.ts`,
which every mutating route calls inside the request that does the work. Deleting
`proxy.ts` entirely would cost polish, not safety.

Password hashing deliberately does **not** happen at the proxy layer: `jose` runs on
Web Crypto and works there, whereas bcrypt does not.

### Details worth noting

- **No user enumeration.** "No such account" and "wrong password" return an identical
  401, and the bcrypt comparison still runs against a dummy hash when the account is
  missing so the two paths take comparable time.
- **Algorithm pinning.** `jwtVerify` is restricted to `HS256`, so a token claiming
  `alg: none` is rejected. There is a test for this, and one that forges a payload
  with `role` escalated to `manager` while keeping the original signature.
- **The token is not authority for mutations.** It carries `role` and `profession` so
  the UI and the proxy redirect need no database round-trip, but the claim engine
  re-reads the user document inside its transaction. A stale or tampered token
  therefore cannot widen what a request is permitted to do.
- **`secure` is conditional on `NODE_ENV`,** because Vercel terminates TLS but local
  development is plain HTTP.

## 4. Keeping shift availability correct under concurrent users

The brief asks that "a shift's availability should stay accurate no matter how many
people are acting on it at once". Two different mechanisms deliver that, and they
are not the same thing — only one of them is a real design decision.

### Capacity is protected by same-document contention

Every claimant for a shift writes that shift's document. MongoDB transactions are
snapshot-isolated with first-committer-wins detection, so two concurrent writes to
the same document raise a `WriteConflict`; `withTransaction` retries the loser,
which re-reads and finds the slot gone. Overbooking is impossible here even without
a filter predicate.

The capacity guard —
`$expr: { $lt: [filled.<profession>, requirements.<profession>] }` — is still worth
having. It rejects in a single round trip instead of aborting and retrying under
contention, and it makes the rule a property of the write itself rather than a
consequence of the retry loop.

### Overlap is protected by writing to the claimant's own document

This is the actual decision, and it is the one worth explaining.

The natural implementation of the overlap rule is to query the shifts collection
for that person's other claims, and then write only the shift. **That is wrong under
concurrency.** Two claims by the same person, on two different overlapping shifts,
touch disjoint documents. Nothing collides, both transactions commit, and the person
is double-booked. This is textbook write skew: snapshot isolation permits it, and no
amount of retrying will detect it, because there is no conflict to detect.

So a claim also pushes onto the claimant's own `bookings` array, under a
`$not: { $elemMatch: <overlapping interval> }` predicate. That one array is the
contention point that forces two concurrent overlapping claims to collide.

### This was verified, not assumed

I deliberately replaced the user-document write with the shifts-collection query
described above and re-ran the suite. The write-skew tests failed exactly as
predicted — one nurse ended up holding both overlapping shifts, and five of five in
the many-shift case. Restoring the write made them pass again.

Worth recording that the first sabotage I tried — removing only the filter
predicates while keeping both writes — *still passed*, because same-document
contention plus the driver's retry already covers the capacity case. That is what
prompted separating the two mechanisms above rather than claiming the predicates do
all the work.

### Consequences elsewhere

- **One code path.** Staff self-claim, manager assignment, and release all call the
  same function, differing only in the permission check and an `assignedBy` field.
  "These rules must also hold when a manager assigns someone" is therefore true by
  construction, not by remembering to duplicate the checks.
- **Failing the second write rolls back the first.** If the booking is reserved and
  the shift is then full, the transaction aborts and the reservation disappears —
  nobody is left holding time for a shift they did not get. There is a test.
- **Diagnostic reads before enforcement.** The guarded updates alone would only say
  "no". A read beforehand determines *which* rule was hit, so the user is told "this
  overlaps a shift already claimed on 2026-08-17 22:00-06:00" rather than a generic
  refusal. Those reads enforce nothing; if one races, the guard below still rejects.
- **A requirement of zero gets its own message.** Technically `filled >= required` is
  already true at zero, but "this shift does not need any doctors" is a more useful
  sentence than "this shift already has enough doctors".
- **Release decrements the profession recorded on the claim,** not the claimant's
  current profession, so the counter stays balanced even if their profession changed
  after they claimed.

## 5. Editing a shift that already has claims

> The brief leaves this open: *"Editing a shift that already has claims is up to you
> to design. Decide what happens to the people who claimed it, and document your
> decision."*

**The policy: re-validate and disclose. Never silently drop, never block the edit.**

Three options were on the table:

1. **Refuse to edit a claimed shift.** Safe and useless — a manager cannot fix a
   typo on the one shift that matters most.
2. **Edit freely and silently drop whoever no longer fits.** Convenient, and the
   worst option: someone finds out they are off a shift by noticing it missing.
3. **Preview, confirm, disclose.** What is implemented.

### How it works

Editing is two steps. `previewShiftEdit` is a dry run that answers "who would this
affect, and why", naming each person and the reason:

> *Ben Ali would now clash with their shift on 2026-08-17 22:00-16:00.*
> *Ivy Bell would be released because the shift now needs only 1 nurse.*

If the manager confirms, `applyShiftEdit` performs the edit and the releases in a
single transaction, so the shift never exists in a state where its claims contradict
its requirements.

Both rules are re-checked, not just the one that obviously changed:

- **Times moved** → every claimant is re-tested against their *other* commitments.
- **Requirements lowered** → the excess is released.

Overlap is resolved first and capacity is then measured against whoever survives, so
nobody is reported twice for one edit.

### Who gets released when capacity shrinks

**Most recent claim first.** Someone who claimed the shift a week ago has planned
around it; someone who claimed it a minute ago has not. Seniority of claim is the
fairest tiebreak available without inventing a priority system the brief did not ask
for.

### Guarding against a stale preview

The preview returns the shift's `updatedAt`, and the confirming request must send it
back. If anyone claims or edits the shift in between, the confirm is refused with
`SHIFT_CHANGED` and the manager sees the new situation. Without this, a manager
could be shown "this affects nobody", have someone claim the last slot while they
read it, and then release that person without ever being told.

### The part that would have been invisible

Claims are denormalised onto each claimant as a `bookings` entry, and that array is
what the overlap rule reads. So when a shift's times change, **the surviving
claimants' bookings have to move with it**. Miss that, and the overlap rule keeps
evaluating those people against the shift's old hours forever — they would be
blocked from a slot that is now free, and bookable onto one that genuinely clashes.

Nothing surfaces this in normal use; the shift looks right and the counts add up.
There is a test that moves a claimed shift from 08:00-16:00 to 18:00-22:00 and then
proves the nurse can claim the vacated morning and *cannot* claim a clashing
evening. Deleting the booking-move code makes it fail.

Deletion has the same hazard and the same fix: removing a shift pulls its bookings
from everyone who held it.

## 6. Recurring shifts

_§13_

## 7. Live updates

_§14_

---

## What I would do differently with more time

_§16_
