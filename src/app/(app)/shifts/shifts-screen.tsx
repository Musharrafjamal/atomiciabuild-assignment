"use client";

import { useEffect, useMemo, useState } from "react";
import { useWeekParam } from "@/lib/client/use-week";
import type { ShiftView } from "@/lib/api/views";
import { ApiFailure, api, refreshWeek, useWeek } from "@/lib/client/api";
import { useLiveShifts } from "@/lib/client/use-live-shifts";
import { LiveBadge } from "@/components/live-badge";
import { clinicToday, formatClinicDate } from "@/lib/time";
import { Button, Empty, cx } from "@/components/ui";
import { WeekNav } from "@/components/week-nav";
import { FillTally, MissingChips, StatusBar, shortName } from "@/components/coverage";

/**
 * The staff view: this week's shifts, grouped by day, with claim and release.
 *
 * Claiming is optimistic -- the button and the counts move immediately -- but a
 * server rejection rolls the row back and pins the exact reason underneath it.
 * The rules are enforced server-side regardless of what this component believes,
 * so the optimism is purely about how the interface feels.
 */
export function ShiftsScreen({
  initialWeek,
  viewerId,
  viewerName,
  canManage,
}: {
  initialWeek: string;
  viewerId: string;
  viewerName: string;
  canManage: boolean;
}) {
  const [week, goToWeek] = useWeekParam(initialWeek);

  // Errors are keyed by shift id, so they must not survive a week change.
  const setWeek = (next: string) => {
    setErrors({});
    goToWeek(next);
  };
  const { data, isLoading } = useWeek(week);

  const live = useLiveShifts(() => refreshWeek(week));
  useEffect(() => {
    if (live !== "polling") return;
    const id = setInterval(() => refreshWeek(week), 8000);
    return () => clearInterval(id);
  }, [live, week]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [onlyMine, setOnlyMine] = useState(false);

  const shifts = useMemo(() => {
    const all = data?.shifts ?? [];
    return onlyMine ? all.filter((s) => s.claimedByMe) : all;
  }, [data, onlyMine]);

  const byDay = useMemo(() => {
    const map = new Map<string, ShiftView[]>();
    for (const shift of shifts) {
      const list = map.get(shift.date) ?? [];
      list.push(shift);
      map.set(shift.date, list);
    }
    return map;
  }, [shifts]);

  const mineThisWeek = (data?.shifts ?? []).filter((s) => s.claimedByMe).length;

  async function act(shift: ShiftView, action: "claim" | "release") {
    setPending((p) => ({ ...p, [shift.id]: true }));
    setErrors((e) => {
      if (!(shift.id in e)) return e;
      const next = { ...e };
      delete next[shift.id];
      return next;
    });

    try {
      if (action === "claim") await api.post(`/api/shifts/${shift.id}/claim`);
      else await api.del(`/api/shifts/${shift.id}/claim`);
      await refreshWeek(week);
    } catch (error) {
      const message =
        error instanceof ApiFailure ? error.message : "Something went wrong.";
      setErrors((e) => ({ ...e, [shift.id]: message }));
      // Re-sync: the refusal may be because our view of the shift was stale.
      await refreshWeek(week);
    } finally {
      setPending((p) => ({ ...p, [shift.id]: false }));
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <WeekNav week={week} onChange={setWeek}>
        <LiveBadge status={live} />
        <button
          type="button"
          onClick={() => setOnlyMine((v) => !v)}
          aria-pressed={onlyMine}
          className={cx(
            "h-9 rounded-[3px] border px-3 text-sm transition-colors",
            onlyMine
              ? "border-ink bg-ink text-paper"
              : "border-rule-strong bg-paper-raised text-ink-muted hover:border-ink hover:text-ink",
          )}
        >
          Mine
          <span className="numeric ml-1.5 opacity-70">{mineThisWeek}</span>
        </button>
      </WeekNav>

      {!canManage && (
        <p className="-mt-3 text-sm text-ink-muted">
          Claiming a shift commits {viewerName.split(" ")[0]} to it. You can only
          claim shifts that still need someone of your profession, and that do not
          overlap something you already hold.
        </p>
      )}

      {isLoading && !data ? (
        <SkeletonDays />
      ) : byDay.size === 0 ? (
        <Empty
          title={onlyMine ? "You have no shifts this week" : "No shifts this week"}
          body={
            onlyMine
              ? "Turn off the Mine filter to see everything that still needs cover."
              : data?.nearestWeek
                ? `The rota runs from ${formatClinicDate(data.nearestWeek, {
                    day: "numeric",
                    month: "long",
                  })}.`
                : "No shifts have been scheduled yet."
          }
          action={
            !onlyMine && data?.nearestWeek ? (
              <Button variant="solid" onClick={() => setWeek(data.nearestWeek!)}>
                Go to that week
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {(data?.days ?? []).map((day) => {
            const list = byDay.get(day);
            if (!list?.length) return null;
            return (
              <section key={day} className="flex flex-col gap-3">
                <DayHeading day={day} count={list.length} />
                <ul className="flex flex-col gap-2">
                  {list.map((shift, i) => (
                    <li
                      key={shift.id}
                      className="rise"
                      style={{ animationDelay: `${Math.min(i * 28, 240)}ms` }}
                    >
                      <ShiftRow
                        shift={shift}
                        viewerId={viewerId}
                        canManage={canManage}
                        busy={!!pending[shift.id]}
                        error={errors[shift.id]}
                        onAct={act}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DayHeading({ day, count }: { day: string; count: number }) {
  const isToday = day === clinicToday();
  return (
    <div className="sticky top-14 z-20 -mx-1 flex items-baseline gap-3 border-b border-rule bg-paper/90 px-1 py-2 backdrop-blur-sm">
      <h2 className="text-sm font-semibold tracking-tight text-ink">
        {formatClinicDate(day, { weekday: "long" })}
        <span className="ml-2 font-normal text-ink-faint">
          {formatClinicDate(day, { day: "numeric", month: "short" })}
        </span>
      </h2>
      {isToday && <span className="label !text-ink">Today</span>}
      <span className="numeric ml-auto text-xs text-ink-faint">{count}</span>
    </div>
  );
}

function ShiftRow({
  shift,
  viewerId,
  canManage,
  busy,
  error,
  onAct,
}: {
  shift: ShiftView;
  viewerId: string;
  canManage: boolean;
  busy: boolean;
  error?: string;
  onAct: (shift: ShiftView, action: "claim" | "release") => void;
}) {
  const others = shift.claims.filter((c) => c.userId !== viewerId);

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-[3px] border bg-paper-raised transition-colors",
        shift.claimedByMe ? "border-ink" : "border-rule",
      )}
    >
      <StatusBar status={shift.status} />

      <div className="flex flex-col gap-3 py-3 pl-4 pr-3 sm:flex-row sm:items-center sm:gap-5">
        {/* Time — the primary scanning axis, so it leads and it is tabular. */}
        <div className="shrink-0">
          <div className="numeric text-[15px] font-medium tracking-tight text-ink">
            {shift.startLabel}
            <span className="mx-1 text-ink-faint">–</span>
            {shift.endLabel}
          </div>
          {shift.crossesMidnight && (
            <div className="label mt-0.5 !text-[9px]">Overnight</div>
          )}
        </div>

        <div className="h-px w-full bg-rule sm:h-8 sm:w-px" aria-hidden="true" />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <MissingChips shift={shift} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <FillTally shift={shift} />
            {others.length > 0 && (
              <span className="truncate text-xs text-ink-faint">
                with {others.map((c) => shortName(c.name)).join(", ")}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {shift.claimedByMe && (
            <span className="label !text-ink">You are on</span>
          )}
          {shift.claimedByMe ? (
            <Button
              size="sm"
              variant="danger"
              busy={busy}
              onClick={() => onAct(shift, "release")}
            >
              Release
            </Button>
          ) : (
            <Button
              size="sm"
              variant="solid"
              busy={busy}
              disabled={canManage || shift.status === "full"}
              title={
                canManage
                  ? "Managers assign staff from the coverage board"
                  : undefined
              }
              onClick={() => onAct(shift, "claim")}
            >
              Claim
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-t border-empty-edge bg-empty-bg px-4 py-2 text-xs leading-snug text-empty">
          {error}
        </div>
      )}
    </div>
  );
}

function SkeletonDays() {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      {[0, 1, 2].map((d) => (
        <div key={d} className="flex flex-col gap-3">
          <div className="h-4 w-40 animate-pulse rounded bg-paper-inset" />
          {[0, 1, 2].map((r) => (
            <div
              key={r}
              className="h-16 animate-pulse rounded-[3px] border border-rule bg-paper-sunken"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
