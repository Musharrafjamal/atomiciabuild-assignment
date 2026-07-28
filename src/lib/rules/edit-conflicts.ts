import {
  PROFESSION_LABEL,
  PROFESSIONS,
  type Profession,
  type StaffCount,
} from "@/lib/db/schema";
import { clinicDayKey, clinicTimeLabel, intervalsOverlap } from "@/lib/time";

/**
 * Works out which existing claims an edit would invalidate, and why.
 *
 * Pure: it takes the current claims and the claimants' other bookings and returns
 * a decision. No database access, so the rule is unit-testable and the same
 * computation drives both the manager's preview and the write that follows it.
 */

export interface ClaimLike {
  userId: string;
  name: string;
  profession: Profession;
  claimedAt: Date;
}

export interface BookingLike {
  shiftId: string;
  startAt: Date;
  endAt: Date;
}

export interface EditConflict {
  userId: string;
  name: string;
  profession: Profession;
  reason: "overlap" | "capacity";
  /** Sentence shown to the manager in the confirmation dialog. */
  detail: string;
}

export interface EditProposal {
  shiftId: string;
  startAt: Date;
  endAt: Date;
  requirements: StaffCount;
}

export interface ConflictInput extends EditProposal {
  claims: ClaimLike[];
  /** Every booking held by each claimant, including the one for this shift. */
  bookingsByUser: Map<string, BookingLike[]>;
}

const describe = (b: { startAt: Date; endAt: Date }) =>
  `${clinicDayKey(b.startAt)} ${clinicTimeLabel(b.startAt)}-${clinicTimeLabel(b.endAt)}`;

/**
 * Order matters here. Overlap is resolved first, then capacity is measured against
 * whoever is left -- otherwise someone could be released for capacity when they
 * were going to be released for an overlap anyway, and the manager would be shown
 * two reasons for one person.
 *
 * When capacity has to release people, the most recently claimed go first. Someone
 * who claimed the shift a week ago has probably planned around it; someone who
 * claimed it a minute ago has not.
 */
export function computeEditConflicts(input: ConflictInput): EditConflict[] {
  const { claims, bookingsByUser, shiftId, startAt, endAt, requirements } = input;
  const conflicts: EditConflict[] = [];

  /* -- 1. Overlap against each claimant's other commitments --------------- */

  const survivingOverlap: ClaimLike[] = [];

  for (const claim of claims) {
    const others = (bookingsByUser.get(claim.userId) ?? []).filter(
      (b) => b.shiftId !== shiftId,
    );
    const clash = others.find((b) =>
      intervalsOverlap(b.startAt, b.endAt, startAt, endAt),
    );

    if (clash) {
      conflicts.push({
        userId: claim.userId,
        name: claim.name,
        profession: claim.profession,
        reason: "overlap",
        detail: `${claim.name} would now clash with their shift on ${describe(clash)}.`,
      });
    } else {
      survivingOverlap.push(claim);
    }
  }

  /* -- 2. Capacity against whoever is left -------------------------------- */

  for (const profession of PROFESSIONS) {
    const held = survivingOverlap
      .filter((c) => c.profession === profession)
      // Most recently claimed first, so those are the ones dropped.
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime());

    const allowed = requirements[profession];
    const excess = held.length - allowed;
    if (excess <= 0) continue;

    const label = PROFESSION_LABEL[profession];
    for (const claim of held.slice(0, excess)) {
      conflicts.push({
        userId: claim.userId,
        name: claim.name,
        profession,
        reason: "capacity",
        detail:
          allowed === 0
            ? `${claim.name} would be released because the shift no longer needs ${label.many}.`
            : `${claim.name} would be released because the shift now needs only ${allowed} ${allowed === 1 ? label.one : label.many}.`,
      });
    }
  }

  return conflicts;
}

/** True when the proposal changes anything that requires re-validation. */
export function changesAnything(
  current: { startAt: Date; endAt: Date; requirements: StaffCount },
  next: EditProposal,
): boolean {
  if (current.startAt.getTime() !== next.startAt.getTime()) return true;
  if (current.endAt.getTime() !== next.endAt.getTime()) return true;
  return PROFESSIONS.some((p) => current.requirements[p] !== next.requirements[p]);
}
