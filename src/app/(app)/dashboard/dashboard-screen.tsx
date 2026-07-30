"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShiftView } from "@/lib/api/views";
import { PROFESSIONS, PROFESSION_LABEL } from "@/lib/domain";
import { refreshWeek, useWeek } from "@/lib/client/api";
import { useLiveShifts } from "@/lib/client/use-live-shifts";
import { LiveBadge } from "@/components/live-badge";
import { useWeekParam } from "@/lib/client/use-week";
import { clinicToday, formatClinicDate } from "@/lib/time";
import { Button, Empty, cx } from "@/components/ui";
import { WeekNav } from "@/components/week-nav";
import { MissingChips, StatusBar, shortName } from "@/components/coverage";
import { ShiftDetail } from "@/components/shift-detail";
import { ShiftEditor } from "@/components/shift-editor";

/**
 * The coverage dashboard: a week at a glance, with the gaps doing the talking.
 *
 * Responsive strategy, since the brief says this view is checked for it:
 *   - >=1280px  seven day columns side by side, the whole week in one view
 *   - 768-1279  the same columns, scrolled horizontally with scroll snapping
 *   - <768px    a single-column agenda, because seven columns on a phone is
 *               unreadable at any font size worth having
 *
 * It is one grid whose columns become a scroller and then a stack, rather than
 * three separate layouts, so a shift card looks and behaves identically at every
 * width.
 */
export function DashboardScreen({ initialWeek }: { initialWeek: string }) {
  const [week, goToWeek] = useWeekParam(initialWeek);
  const { data, isLoading } = useWeek(week);

  /*
   * Live updates. The stream says something changed and we refetch the week --
   * the server stays the source of truth, so there is no partial-update merge
   * logic to get wrong. When the stream is unavailable the hook reports
   * "polling" and the interval below takes over, so the board is never silently
   * stale.
   *
   * `recentlyChanged` briefly marks what moved. Without it a live update in a
   * dense week is invisible: numbers change somewhere on screen and nothing
   * draws the eye to them.
   */
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());
  const live = useLiveShifts((shiftId) => {
    refreshWeek(week);
    if (!shiftId) return;
    setRecentlyChanged((prev) => new Set(prev).add(shiftId));
    setTimeout(
      () =>
        setRecentlyChanged((prev) => {
          const next = new Set(prev);
          next.delete(shiftId);
          return next;
        }),
      1800,
    );
  });
  useEffect(() => {
    if (live !== "polling") return;
    const id = setInterval(() => refreshWeek(week), 8000);
    return () => clearInterval(id);
  }, [live, week]);

  const [selected, setSelected] = useState<ShiftView | null>(null);
  const [editing, setEditing] = useState<ShiftView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDay, setEditorDay] = useState(initialWeek);

  // Memoised so the fallback arrays keep a stable identity between renders and
  // the derived maps below are not rebuilt on every paint.
  const shifts = useMemo(() => data?.shifts ?? [], [data]);
  const days = useMemo(() => data?.days ?? [], [data]);

  const byDay = useMemo(() => {
    const map = new Map<string, ShiftView[]>();
    for (const day of days) map.set(day, []);
    for (const shift of shifts) {
      map.get(shift.date)?.push(shift);
    }
    return map;
  }, [days, shifts]);

  const tally = useMemo(() => {
    const counts = { full: 0, partial: 0, empty: 0, unfilled: 0 };
    for (const shift of shifts) {
      counts[shift.status] += 1;
      for (const profession of PROFESSIONS) {
        counts.unfilled += shift.missing[profession];
      }
    }
    return counts;
  }, [shifts]);

  // Keep the open detail panel in step with refreshed data.
  const selectedLive = selected
    ? (shifts.find((s) => s.id === selected.id) ?? null)
    : null;

  function openEditor(shift: ShiftView | null, day: string) {
    setEditing(shift);
    setEditorDay(day);
    setEditorOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <WeekNav week={week} onChange={goToWeek}>
        <LiveBadge status={live} />
        <Button variant="solid" onClick={() => openEditor(null, days[0] ?? week)}>
          <Plus /> New shift
        </Button>
      </WeekNav>

      <WeekSummary tally={tally} total={shifts.length} loading={isLoading && !data} />

      {!isLoading && shifts.length === 0 ? (
        <Empty
          title="No shifts scheduled this week"
          body={
            data?.nearestWeek
              ? `The rota runs from ${formatClinicDate(data.nearestWeek, {
                  day: "numeric",
                  month: "long",
                })}.`
              : "Create the first shift to start building the rota."
          }
          action={
            data?.nearestWeek ? (
              <Button variant="solid" onClick={() => goToWeek(data.nearestWeek!)}>
                Go to that week
              </Button>
            ) : (
              <Button variant="solid" onClick={() => openEditor(null, week)}>
                Create a shift
              </Button>
            )
          }
        />
      ) : (
        <div
          className={cx(
            "scroll-x -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6",
            "xl:mx-0 xl:overflow-visible xl:px-0",
          )}
        >
          <div
            className={cx(
              // Phone: one column stack. Tablet: snap-scrolled columns.
              // Desktop: the full week side by side.
              //
              // `md:grid-cols-none` is load-bearing. Without it the base
              // `grid-cols-1` still defines one explicit column track at md, so
              // the first day lands in that full-width track while the other six
              // flow into the auto columns -- Monday ends up underneath Tuesday.
              "grid grid-cols-1 gap-3",
              "md:grid-cols-none md:auto-cols-[minmax(230px,1fr)] md:grid-flow-col md:snap-x md:snap-mandatory",
              "xl:grid-flow-row xl:grid-cols-7 xl:gap-2",
            )}
          >
            {days.map((day, index) => (
              <DayColumn
                key={day}
                day={day}
                shifts={byDay.get(day) ?? []}
                index={index}
                loading={isLoading && !data}
                changedIds={recentlyChanged}
                onSelect={setSelected}
                onAdd={() => openEditor(null, day)}
              />
            ))}
          </div>
        </div>
      )}

      <ShiftDetail
        shift={selectedLive}
        onClose={() => setSelected(null)}
        onChanged={() => refreshWeek(week)}
        onEdit={(shift) => {
          setSelected(null);
          openEditor(shift, shift.date);
        }}
      />

      <ShiftEditor
        open={editorOpen}
        shift={editing}
        defaultDay={editorDay}
        onClose={() => setEditorOpen(false)}
        onSaved={() => refreshWeek(week)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function WeekSummary({
  tally,
  total,
  loading,
}: {
  tally: { full: number; partial: number; empty: number; unfilled: number };
  total: number;
  loading: boolean;
}) {
  if (loading) {
    return <div className="h-16 animate-pulse rounded-[3px] bg-paper-inset" />;
  }

  const cells = [
    { label: "Shifts", value: total, tone: "" },
    { label: "Fully staffed", value: tally.full, tone: "text-ok" },
    { label: "Short", value: tally.partial, tone: "text-short" },
    { label: "Nobody yet", value: tally.empty, tone: "text-empty" },
    { label: "Places unfilled", value: tally.unfilled, tone: "" },
  ];

  return (
    <dl className="grid grid-cols-2 divide-y divide-rule border border-rule bg-paper-raised sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cx(
            "flex flex-col gap-0.5 px-4 py-3",
            i > 0 && "sm:border-l sm:border-rule",
          )}
        >
          <dt className="label">{cell.label}</dt>
          <dd
            className={cx(
              "numeric text-2xl font-semibold tracking-tight",
              cell.tone || "text-ink",
            )}
          >
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DayColumn({
  day,
  shifts,
  index,
  loading,
  changedIds,
  onSelect,
  onAdd,
}: {
  day: string;
  shifts: ShiftView[];
  index: number;
  loading: boolean;
  changedIds: Set<string>;
  onSelect: (shift: ShiftView) => void;
  onAdd: () => void;
}) {
  const isToday = day === clinicToday();
  const gaps = shifts.reduce(
    (n, s) => n + PROFESSIONS.reduce((m, p) => m + s.missing[p], 0),
    0,
  );

  return (
    <section
      className={cx(
        "flex snap-start flex-col rounded-[3px] border",
        isToday ? "border-ink bg-paper-raised" : "border-rule bg-paper-sunken/40",
      )}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <header
        className={cx(
          "flex items-baseline gap-2 border-b px-2.5 py-2",
          isToday ? "border-ink/25" : "border-rule",
        )}
      >
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          {formatClinicDate(day, { weekday: "short" })}
        </h2>
        <span className="numeric text-xs text-ink-faint">
          {formatClinicDate(day, { day: "numeric" })}
        </span>
        {isToday && <span className="label !text-ink">Today</span>}
        {gaps > 0 && (
          <span className="numeric ml-auto text-[11px] font-medium text-short">
            {gaps} to fill
          </span>
        )}
        {gaps === 0 && shifts.length > 0 && (
          <span className="ml-auto text-[11px] font-medium text-ok">Covered</span>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
        {loading ? (
          <div className="h-20 animate-pulse rounded-[3px] bg-paper-inset" />
        ) : shifts.length === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            className="flex flex-1 items-center justify-center rounded-[3px] border border-dashed border-rule px-2 py-6 text-xs text-ink-faint transition-colors hover:border-ink hover:text-ink"
          >
            + Add shift
          </button>
        ) : (
          <>
            {shifts.map((shift, i) => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                changed={changedIds.has(shift.id)}
                delay={index * 20 + i * 12}
                onClick={() => onSelect(shift)}
              />
            ))}
            <button
              type="button"
              onClick={onAdd}
              aria-label={`Add a shift on ${formatClinicDate(day, { weekday: "long" })}`}
              className="rounded-[3px] border border-dashed border-rule py-1.5 text-xs text-ink-faint transition-colors hover:border-ink hover:text-ink"
            >
              +
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function ShiftCard({
  shift,
  delay,
  changed,
  onClick,
}: {
  shift: ShiftView;
  delay: number;
  changed: boolean;
  onClick: () => void;
}) {
  /*
   * The card's visible content is chips and abbreviations, which announce poorly.
   * An explicit label gives a screen reader the whole shift in one sentence --
   * when it is, and exactly what it still needs.
   */
  const gaps = PROFESSIONS.filter((p) => shift.missing[p] > 0).map(
    (p) => `${shift.missing[p]} ${PROFESSION_LABEL[p][shift.missing[p] === 1 ? "one" : "many"]}`,
  );
  const label =
    `${shift.startLabel} to ${shift.endLabel} on ` +
    formatClinicDate(shift.date, { weekday: "long", day: "numeric", month: "long" }) +
    (gaps.length ? `. Still needs ${gaps.join(", ")}.` : ". Fully staffed.");

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // A stable hook for the live-update and end-to-end checks to find one
      // specific card without depending on its text or position.
      data-shift-id={shift.id}
      data-status={shift.status}
      // Capped tight: this is an operational board, and a manager scanning for
      // gaps should not wait on a reveal. The stagger is a hint of order, not a
      // performance.
      style={{ animationDelay: `${Math.min(delay, 180)}ms` }}
      className={cx(
        "rise relative w-full overflow-hidden rounded-[3px] border bg-paper-raised",
        changed ? "flash border-focus" : "border-rule",
        "px-2.5 py-2 pl-3 text-left transition-all",
        "hover:border-ink hover:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.35)]",
      )}
    >
      <StatusBar status={shift.status} />

      <div className="flex items-baseline justify-between gap-1.5">
        <span className="numeric text-[13px] font-medium tracking-tight text-ink">
          {shift.startLabel}–{shift.endLabel}
        </span>
        {shift.crossesMidnight && (
          <span className="label !text-[8px]">+1</span>
        )}
      </div>

      {/*
        Only the shortfall is shown here, not a filled/required tally as well.
        The two say the same thing, and carrying both doubled the height of every
        card -- which on a seven-column week grid is the difference between
        seeing the week and scrolling it. The full breakdown is in the detail
        panel, where there is room for it.
      */}
      <div className="mt-1.5">
        <MissingChips shift={shift} size="sm" />
      </div>

      {shift.claims.length > 0 && (
        <div className="mt-1.5 truncate text-[11px] text-ink-faint">
          {shift.claims.map((c) => shortName(c.name)).join(", ")}
        </div>
      )}
    </button>
  );
}

function Plus() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M6 2v8M2 6h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
