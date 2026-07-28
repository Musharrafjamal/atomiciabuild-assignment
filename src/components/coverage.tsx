"use client";

import { PROFESSION_LABEL, PROFESSIONS } from "@/lib/domain";
import type { ShiftView } from "@/lib/api/views";
import { cx } from "./ui";

/**
 * The coverage language, in one place so it reads identically everywhere.
 *
 * The brief asks the dashboard to show "specifically which roles are still
 * missing", so the chips lead with the shortfall rather than the total: a
 * manager scanning a week needs to see "2 nurses short", not "1/3 nurses" and
 * then do the subtraction themselves.
 */

const STATUS_STYLES = {
  full: {
    bar: "bg-ok",
    text: "text-ok",
    chip: "border-ok-edge bg-ok-bg text-ok",
    label: "Fully staffed",
  },
  partial: {
    bar: "bg-short",
    text: "text-short",
    chip: "border-short-edge bg-short-bg text-short",
    label: "Short",
  },
  empty: {
    bar: "bg-empty",
    text: "text-empty",
    chip: "border-empty-edge bg-empty-bg text-empty",
    label: "Nobody yet",
  },
} as const;

export function statusStyle(status: ShiftView["status"]) {
  return STATUS_STYLES[status];
}

/** e.g. "2 nurses", "1 doctor" — pluralised against the count. */
export function roleCount(profession: keyof typeof PROFESSION_LABEL, n: number) {
  const label = PROFESSION_LABEL[profession];
  return `${n} ${n === 1 ? label.one : label.many}`;
}

/**
 * What is still needed. Renders nothing when the shift is fully staffed, so a
 * covered week is visually quiet and the gaps are the only thing shouting.
 */
export function MissingChips({
  shift,
  size = "md",
}: {
  shift: ShiftView;
  size?: "sm" | "md";
}) {
  const gaps = PROFESSIONS.filter((p) => shift.missing[p] > 0);

  if (gaps.length === 0) {
    return (
      <span
        className={cx(
          "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-medium",
          STATUS_STYLES.full.chip,
          size === "sm" ? "text-[10px]" : "text-xs",
        )}
      >
        <Tick /> Fully staffed
      </span>
    );
  }

  /*
   * The chip takes the *shift's* status rather than the individual profession's,
   * so it agrees with the status bar beside it. Red therefore means one specific
   * thing -- nobody at all is on this shift -- which keeps it rare enough to be
   * worth noticing. Colouring each profession independently turned an unstaffed
   * week into a wall of red where nothing stood out.
   */
  const chip =
    shift.status === "empty"
      ? STATUS_STYLES.empty.chip
      : STATUS_STYLES.partial.chip;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {gaps.map((profession) => (
        <span
          key={profession}
          className={cx(
            "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-medium",
            chip,
            size === "sm" ? "text-[10px]" : "text-xs",
          )}
        >
          <span className="numeric">
            {roleCount(profession, shift.missing[profession])}
          </span>
          <span className="ml-1 opacity-70">short</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A compact filled/required readout, e.g. "2/3". Complements the chips above for
 * anyone who wants the absolute numbers.
 */
export function FillTally({ shift }: { shift: ShiftView }) {
  const needed = PROFESSIONS.filter((p) => shift.requirements[p] > 0);
  if (needed.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {needed.map((profession) => {
        const done = shift.filled[profession] >= shift.requirements[profession];
        return (
          <span key={profession} className="inline-flex items-baseline gap-1">
            <span
              className={cx(
                "numeric text-xs font-medium",
                done ? "text-ok" : "text-ink",
              )}
            >
              {shift.filled[profession]}/{shift.requirements[profession]}
            </span>
            <span className="label !text-[9px]">
              {PROFESSION_LABEL[profession].many}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** The left-edge status bar that makes a wall of shifts scannable at a glance. */
export function StatusBar({ status }: { status: ShiftView["status"] }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "absolute inset-y-0 left-0 w-[3px]",
        STATUS_STYLES[status].bar,
      )}
    />
  );
}

function Tick() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 6.5l2.5 2.5 4.5-5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
