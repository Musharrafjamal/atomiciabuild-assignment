"use client";

import type { ImportOutcome } from "@/lib/domain";
import { cx } from "./ui";

/**
 * Shared vocabulary for import outcomes.
 *
 * Four outcomes rather than three, because "this clashed with another row in
 * your file" and "this row is unusable on its own terms" are different problems
 * with different fixes, and a manager should not have to read the reason text to
 * tell them apart.
 */

export const OUTCOME_STYLE: Record<
  ImportOutcome,
  { label: string; chip: string; bar: string; blurb: string }
> = {
  accepted: {
    label: "Accepted",
    chip: "border-ok-edge bg-ok-bg text-ok",
    bar: "bg-ok",
    blurb: "Imported.",
  },
  merged: {
    label: "Merged",
    chip: "border-rule-strong bg-paper-inset text-ink-muted",
    bar: "bg-ink-faint",
    blurb: "Identical to an earlier row; imported once.",
  },
  conflict: {
    label: "Conflict",
    chip: "border-short-edge bg-short-bg text-short",
    bar: "bg-short",
    blurb: "Clashed with an existing record; the earlier one was kept.",
  },
  rejected: {
    label: "Rejected",
    chip: "border-empty-edge bg-empty-bg text-empty",
    bar: "bg-empty",
    blurb: "Could not be read; not imported.",
  },
};

export interface OutcomeSummary {
  total: number;
  accepted: number;
  merged: number;
  conflict: number;
  rejected: number;
}

const ORDER: ImportOutcome[] = ["accepted", "merged", "conflict", "rejected"];

/** A single proportional bar — the shape of the file at a glance. */
export function OutcomeBar({ summary }: { summary: OutcomeSummary }) {
  if (summary.total === 0) return null;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-paper-inset">
      {ORDER.map((outcome) => {
        const value = summary[outcome];
        if (value === 0) return null;
        return (
          <div
            key={outcome}
            className={OUTCOME_STYLE[outcome].bar}
            style={{ width: `${(value / summary.total) * 100}%` }}
            title={`${value} ${OUTCOME_STYLE[outcome].label.toLowerCase()}`}
          />
        );
      })}
    </div>
  );
}

export function OutcomeBadge({
  outcome,
  count,
  active,
  onClick,
}: {
  outcome: ImportOutcome;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const style = OUTCOME_STYLE[outcome];
  const content = (
    <>
      <span className="numeric font-semibold">{count}</span>
      <span className="ml-1">{style.label.toLowerCase()}</span>
    </>
  );

  const className = cx(
    "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-xs transition-colors",
    count === 0 ? "border-rule bg-transparent text-ink-faint" : style.chip,
    onClick && "cursor-pointer hover:border-ink",
    active && "ring-1 ring-ink",
  );

  if (!onClick) return <span className={className}>{content}</span>;

  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {content}
    </button>
  );
}
