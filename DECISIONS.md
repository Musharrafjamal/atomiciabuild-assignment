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

_§2_

## 3. Authentication

_§4_

## 4. Keeping shift availability correct under concurrent users

_§5 — the core of the assignment._

## 5. Editing a shift that already has claims

_§6 — the decision the brief explicitly asks to be designed and documented._

## 6. Recurring shifts

_§13_

## 7. Live updates

_§14_

---

## What I would do differently with more time

_§16_
