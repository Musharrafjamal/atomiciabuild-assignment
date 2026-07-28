"use client";

import { useState } from "react";
import type { ShiftView } from "@/lib/api/views";
import type { EditConflict } from "@/lib/rules/edit-conflicts";
import { PROFESSIONS, PROFESSION_LABEL } from "@/lib/domain";
import { ApiFailure, api } from "@/lib/client/api";
import { Button, Field, Notice, inputClass } from "./ui";
import { Dialog } from "./dialog";

/**
 * Create or edit a shift.
 *
 * Editing a shift that already has claims goes through preview-then-confirm (see
 * DECISIONS.md §5): the first submit asks the server what the change would do to
 * the people already on the shift, and the manager only commits once they have
 * been told. The `expectedUpdatedAt` returned with the preview is sent back with
 * the confirmation, so a claim landing in between is refused rather than silently
 * acted upon.
 */

interface Draft {
  date: string;
  startTime: string;
  endTime: string;
  requirements: Record<string, number>;
}

function draftFrom(shift: ShiftView | null, day: string): Draft {
  if (!shift) {
    return {
      date: day,
      startTime: "08:00",
      endTime: "16:00",
      requirements: { doctor: 0, nurse: 1, receptionist: 0 },
    };
  }
  return {
    date: shift.date,
    startTime: shift.startLabel,
    endTime: shift.endLabel,
    requirements: { ...shift.requirements },
  };
}

interface EditorProps {
  open: boolean;
  /** null when creating. */
  shift: ShiftView | null;
  defaultDay: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Resetting the form when a different shift is opened is done by remounting on a
 * key, not by syncing props into state inside an effect. The effect version
 * renders once with the previous shift's values before correcting itself, and is
 * the classic source of a dialog briefly showing the last thing you edited.
 */
export function ShiftEditor(props: EditorProps) {
  return (
    <EditorForm
      key={`${props.open}:${props.shift?.id ?? "new"}:${props.defaultDay}`}
      {...props}
    />
  );
}

function EditorForm({ open, shift, defaultDay, onClose, onSaved }: EditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(shift, defaultDay));
  const [conflicts, setConflicts] = useState<EditConflict[] | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isEdit = shift !== null;
  const total = PROFESSIONS.reduce((n, p) => n + (draft.requirements[p] ?? 0), 0);

  async function save(confirmed: boolean) {
    setBusy(true);
    setError(null);

    try {
      if (!isEdit) {
        await api.post("/api/shifts", draft);
        onSaved();
        onClose();
        return;
      }

      // Ask first, unless the manager has just been shown the consequences.
      if (!confirmed) {
        const preview = await api.patch<{
          conflicts: EditConflict[];
          expectedUpdatedAt: string;
        }>(`/api/shifts/${shift.id}`, { ...draft, preview: true });

        setExpectedUpdatedAt(preview.expectedUpdatedAt);

        if (preview.conflicts.length > 0) {
          setConflicts(preview.conflicts);
          return; // wait for confirmation
        }
      }

      await api.patch(`/api/shifts/${shift.id}`, {
        ...draft,
        expectedUpdatedAt,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Could not save the shift.");
      setConflicts(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit shift" : "New shift"}
      description={
        isEdit
          ? "Changing the time or the requirements is re-checked against everyone already on this shift."
          : undefined
      }
      footer={
        conflicts ? (
          <>
            <Button onClick={() => setConflicts(null)} disabled={busy}>
              Go back
            </Button>
            <Button variant="danger" busy={busy} onClick={() => save(true)}>
              Release {conflicts.length} and save
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="solid"
              busy={busy}
              disabled={total === 0}
              onClick={() => save(false)}
            >
              {isEdit ? "Save changes" : "Create shift"}
            </Button>
          </>
        )
      }
    >
      {conflicts ? (
        <div className="flex flex-col gap-3">
          <Notice tone="error">
            This change affects {conflicts.length}{" "}
            {conflicts.length === 1 ? "person" : "people"} already on the shift.
          </Notice>
          <ul className="flex flex-col gap-2">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.userId}-${conflict.reason}`}
                className="flex items-start gap-2.5 rounded-[3px] border border-rule bg-paper-raised px-3 py-2"
              >
                <span className="label mt-0.5 shrink-0">
                  {conflict.reason === "overlap" ? "Clash" : "Capacity"}
                </span>
                <span className="text-sm leading-snug text-ink">
                  {conflict.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-ink-faint">
            Saving releases these claims and frees the time in their calendars.
            They are not notified automatically.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Date">
            <input
              className={inputClass}
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input
                className={inputClass}
                type="time"
                step={300}
                value={draft.startTime}
                onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
              />
            </Field>
            <Field
              label="End"
              hint={
                draft.endTime <= draft.startTime ? "Runs past midnight" : undefined
              }
            >
              <input
                className={inputClass}
                type="time"
                step={300}
                value={draft.endTime}
                onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-1">Staff needed</legend>
            <div className="grid grid-cols-3 gap-3">
              {PROFESSIONS.map((profession) => (
                <label key={profession} className="flex flex-col gap-1.5">
                  <span className="text-xs text-ink-muted">
                    {PROFESSION_LABEL[profession].many}
                  </span>
                  <input
                    className={`${inputClass} numeric`}
                    type="number"
                    min={0}
                    max={50}
                    value={draft.requirements[profession] ?? 0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        requirements: {
                          ...draft.requirements,
                          [profession]: Math.max(0, Number(e.target.value) || 0),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {total === 0 && (
              <p className="text-xs text-ink-faint">
                A shift must need at least one person.
              </p>
            )}
          </fieldset>

          {isEdit && shift.claims.length > 0 && (
            <Notice tone="info">
              {shift.claims.length}{" "}
              {shift.claims.length === 1 ? "person is" : "people are"} already on
              this shift. Any change is re-checked against them before it is saved.
            </Notice>
          )}

          {error && <Notice>{error}</Notice>}
        </div>
      )}
    </Dialog>
  );
}
