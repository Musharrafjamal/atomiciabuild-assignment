"use client";

import { useMemo, useState } from "react";
import type { ShiftView, StaffView } from "@/lib/api/views";
import { PROFESSIONS, PROFESSION_LABEL } from "@/lib/domain";
import { ApiFailure, api, useStaff } from "@/lib/client/api";
import { formatClinicDate } from "@/lib/time";
import { Button, Notice, cx } from "./ui";
import { Dialog } from "./dialog";
import { FillTally, MissingChips } from "./coverage";

/**
 * The manager's view of a single shift: who is on it, who can be added, and the
 * way in to editing or deleting it.
 *
 * Assignment posts to exactly the same endpoint a staff member's own claim uses,
 * with a `staffId`. The business rules are therefore identical by construction --
 * a manager cannot assign someone onto an overlapping shift or past a capacity
 * limit, and the refusal comes back with the same sentence a nurse would see.
 */
export function ShiftDetail({
  shift,
  onClose,
  onChanged,
  onEdit,
}: {
  shift: ShiftView | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (shift: ShiftView) => void;
}) {
  const open = shift !== null;
  const { data: staffData } = useStaff(open);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const claimedIds = useMemo(
    () => new Set(shift?.claims.map((c) => c.userId) ?? []),
    [shift],
  );

  /** Only offer people whose profession this shift still needs. */
  const assignable = useMemo(() => {
    if (!shift || !staffData) return [];
    return staffData.staff
      .filter((s) => !claimedIds.has(s.id))
      .filter((s) => shift.missing[s.profession] > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [shift, staffData, claimedIds]);

  async function run(fn: () => Promise<unknown>, id: string) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  if (!shift) return null;

  return (
    <Dialog
      open={open}
      onClose={() => {
        setConfirmDelete(false);
        setError(null);
        onClose();
      }}
      width="lg"
      title={`${formatClinicDate(shift.date, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}`}
      description={`${shift.startLabel}–${shift.endLabel}${
        shift.crossesMidnight ? " (overnight)" : ""
      }`}
      footer={
        confirmDelete ? (
          <>
            <Button onClick={() => setConfirmDelete(false)} disabled={!!busyId}>
              Keep shift
            </Button>
            <Button
              variant="danger"
              busy={busyId === "delete"}
              onClick={() =>
                run(async () => {
                  await api.del(`/api/shifts/${shift.id}`);
                  onClose();
                }, "delete")
              }
            >
              Delete this shift
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <div className="flex-1" />
            <Button onClick={() => onEdit(shift)}>Edit shift</Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <MissingChips shift={shift} />
          <FillTally shift={shift} />
        </div>

        {confirmDelete && (
          <Notice tone="error">
            {shift.claims.length > 0
              ? `Deleting this shift releases ${shift.claims.length} ${
                  shift.claims.length === 1 ? "claim" : "claims"
                } and frees the time in those calendars.`
              : "This shift will be removed."}
          </Notice>
        )}

        {error && <Notice>{error}</Notice>}

        {/* ---- On this shift ---- */}
        <section className="flex flex-col gap-2">
          <h3 className="label">
            On this shift · {shift.claims.length}
          </h3>

          {shift.claims.length === 0 ? (
            <p className="rounded-[3px] border border-dashed border-rule-strong px-3 py-4 text-center text-sm text-ink-faint">
              Nobody has claimed this shift yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-[3px] border border-rule">
              {shift.claims.map((claim) => (
                <li
                  key={claim.userId}
                  className="flex items-center gap-3 bg-paper-raised px-3 py-2"
                >
                  <Initials name={claim.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {claim.name}
                    </div>
                    <div className="label">
                      {PROFESSION_LABEL[claim.profession].one}
                      {claim.assigned && " · assigned"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={busyId === claim.userId}
                    onClick={() =>
                      run(
                        () =>
                          api.del(`/api/shifts/${shift.id}/claim`, {
                            staffId: claim.userId,
                          }),
                        claim.userId,
                      )
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Assign ---- */}
        <section className="flex flex-col gap-2">
          <h3 className="label">Add someone</h3>

          {PROFESSIONS.every((p) => shift.missing[p] === 0) ? (
            <p className="rounded-[3px] border border-ok-edge bg-ok-bg px-3 py-2.5 text-sm text-ok">
              This shift is fully staffed.
            </p>
          ) : assignable.length === 0 ? (
            <p className="rounded-[3px] border border-dashed border-rule-strong px-3 py-4 text-center text-sm text-ink-faint">
              Nobody available of the professions this shift still needs.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col divide-y divide-rule overflow-y-auto rounded-[3px] border border-rule">
              {assignable.map((person) => (
                <AssignRow
                  key={person.id}
                  person={person}
                  busy={busyId === person.id}
                  onAssign={() =>
                    run(
                      () =>
                        api.post(`/api/shifts/${shift.id}/claim`, {
                          staffId: person.id,
                        }),
                      person.id,
                    )
                  }
                />
              ))}
            </ul>
          )}
          <p className="text-xs leading-relaxed text-ink-faint">
            The same rules apply to an assignment as to a staff member claiming for
            themselves — someone already working an overlapping shift will be
            refused.
          </p>
        </section>
      </div>
    </Dialog>
  );
}

function AssignRow({
  person,
  busy,
  onAssign,
}: {
  person: StaffView;
  busy: boolean;
  onAssign: () => void;
}) {
  return (
    <li className="flex items-center gap-3 bg-paper-raised px-3 py-2">
      <Initials name={person.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{person.name}</div>
        <div className="label">{PROFESSION_LABEL[person.profession].one}</div>
      </div>
      <Button size="sm" busy={busy} onClick={onAssign}>
        Assign
      </Button>
    </li>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-full border border-rule-strong",
        "bg-paper-inset text-[10px] font-semibold tracking-wide text-ink-muted",
      )}
    >
      {initials}
    </span>
  );
}
