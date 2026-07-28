"use client";

import { addWeeks, clinicToday, formatClinicDate, weekBounds } from "@/lib/time";
import { Button, cx } from "./ui";

/**
 * Week navigation, presentational. The owning screen handles both the state and
 * the URL through `useWeekParam`, so every route into a week -- an arrow, the
 * date picker, or a jump from an empty state -- goes through one place and the
 * address bar can never disagree with what is on screen.
 *
 * "Jump to any week" is a native date input rather than a custom calendar: it is
 * keyboard accessible for free, and on a phone it opens the platform date wheel.
 */
export function WeekNav({
  week,
  onChange,
  children,
}: {
  week: string;
  onChange: (week: string) => void;
  children?: React.ReactNode;
}) {
  const go = onChange;
  const { start, end } = weekBounds(week);
  const endInclusive = new Date(end.getTime() - 1);
  const today = clinicToday();
  const isThisWeek = weekBounds(today).start.getTime() === start.getTime();

  const span = { day: "numeric", month: "short" } as const;

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        <div className="label">Week of</div>
        <h1 className="display mt-1.5 text-[clamp(1.75rem,4vw,2.75rem)] text-ink">
          {formatClinicDate(start, span)} — {formatClinicDate(endInclusive, span)}
          <span className="ml-2 text-ink-faint">
            {formatClinicDate(start, { year: "numeric" })}
          </span>
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {children}

        <div className="flex items-center rounded-[3px] border border-rule-strong bg-paper-raised">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => go(addWeeks(week, -1))}
            className="h-9 px-2.5 text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
          >
            <Chevron dir="left" />
          </button>
          <div className="h-5 w-px bg-rule" />
          <button
            type="button"
            aria-label="Next week"
            onClick={() => go(addWeeks(week, 1))}
            className="h-9 px-2.5 text-ink-muted transition-colors hover:bg-paper-inset hover:text-ink"
          >
            <Chevron dir="right" />
          </button>
        </div>

        <Button
          onClick={() => go(today)}
          disabled={isThisWeek}
          className={cx(isThisWeek && "opacity-45")}
        >
          Today
        </Button>

        <label className="relative">
          <span className="sr-only">Jump to week</span>
          <input
            type="date"
            value={week}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="h-9 rounded-[3px] border border-rule-strong bg-paper-raised px-2.5 text-sm text-ink-muted transition-colors hover:border-ink focus:border-focus focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={dir === "left" ? "" : "rotate-180"}
    >
      <path
        d="M10 3L5 8l5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
