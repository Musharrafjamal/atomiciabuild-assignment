"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { ImportReportDetailView } from "@/lib/api/views";
import type { ImportOutcome } from "@/lib/domain";
import { api } from "@/lib/client/api";
import { formatClinicDate } from "@/lib/time";
import { Empty, Notice, cx } from "@/components/ui";
import { OUTCOME_STYLE, OutcomeBadge, OutcomeBar } from "@/components/import-report";

/**
 * The import report.
 *
 * The brief asks for "how many rows were accepted, and for every rejected or
 * merged row — the row, what was wrong, and what you did with it". Each row
 * therefore shows all three: the original line exactly as it appeared, the
 * reason, and the action taken.
 *
 * Accepted rows are hidden by default. A 117-row file with 6 problems should
 * open showing the 6, not bury them in a wall of successes -- but the filter is
 * right there, and the count is honest about what is hidden.
 */
export function ReportScreen({ id }: { id: string }) {
  const { data, isLoading, error } = useSWR<{ report: ImportReportDetailView }>(
    `/api/import/${id}`,
    api.get,
  );

  const [filter, setFilter] = useState<ImportOutcome | "problems">("problems");

  const report = data?.report;

  const rows = useMemo(() => {
    if (!report) return [];
    if (filter === "problems") {
      return report.rows.filter((r) => r.outcome !== "accepted");
    }
    return report.rows.filter((r) => r.outcome === filter);
  }, [report, filter]);

  const columns = useMemo(() => {
    const first = report?.rows[0];
    return first ? Object.keys(first.raw) : [];
  }, [report]);

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[3px] bg-paper-inset" />;
  }

  if (error || !report) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>That import report could not be found.</Notice>
        <Link href="/import" className="text-sm underline underline-offset-2">
          Back to imports
        </Link>
      </div>
    );
  }

  const problems =
    report.summary.merged + report.summary.conflict + report.summary.rejected;

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <Link
          href="/import"
          className="label transition-colors hover:!text-ink w-fit"
        >
          ← Imports
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="display text-[clamp(1.5rem,3.5vw,2.25rem)] text-ink">
              {report.filename}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {report.kind} · {report.source} ·{" "}
              {formatClinicDate(report.createdAt, {
                weekday: "short",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          <p className="numeric text-sm text-ink-muted">
            <span className="text-2xl font-semibold text-ink">
              {report.summary.accepted}
            </span>
            <span className="ml-1.5">of {report.summary.total} rows accepted</span>
          </p>
        </div>

        <OutcomeBar summary={report.summary} />
      </header>

      {/* How the importer read the file. */}
      {report.notes.length > 0 && (
        <section className="rounded-[3px] border border-rule bg-paper-sunken/50 px-4 py-3">
          <h2 className="label">How this file was read</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {report.notes.map((note) => (
              <li key={note} className="text-sm leading-snug text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilter("problems")}
          aria-pressed={filter === "problems"}
          className={cx(
            "inline-flex items-center rounded-[3px] border px-2 py-1 text-xs transition-colors",
            filter === "problems"
              ? "border-ink bg-ink text-paper"
              : "border-rule-strong bg-paper-raised text-ink-muted hover:border-ink hover:text-ink",
          )}
        >
          <span className="numeric font-semibold">{problems}</span>
          <span className="ml-1">needing attention</span>
        </button>

        {(["accepted", "merged", "conflict", "rejected"] as const).map((outcome) => (
          <OutcomeBadge
            key={outcome}
            outcome={outcome}
            count={report.summary[outcome]}
            active={filter === outcome}
            onClick={() => setFilter(outcome)}
          />
        ))}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <Empty
          title={
            filter === "problems"
              ? "Every row imported cleanly"
              : `No ${filter} rows`
          }
          body={
            filter === "problems"
              ? "Nothing in this file needed a decision."
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const style = OUTCOME_STYLE[row.outcome];
            return (
              <li
                key={row.rowNumber}
                className="overflow-hidden rounded-[3px] border border-rule bg-paper-raised"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-3 py-2">
                  <span className="label">Line {row.rowNumber}</span>
                  <span
                    className={cx(
                      "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[11px] font-medium",
                      style.chip,
                    )}
                  >
                    {style.label}
                  </span>
                </div>

                {/* The row exactly as it appeared in the file. */}
                <div className="overflow-x-auto scroll-x border-b border-rule bg-paper-sunken/60">
                  <table className="w-full min-w-max text-left">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th
                            key={column}
                            scope="col"
                            className="label px-3 pt-2 pb-0.5 font-medium whitespace-nowrap"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {columns.map((column) => (
                          <td
                            key={column}
                            className="numeric px-3 pt-0.5 pb-2 text-xs whitespace-pre text-ink"
                          >
                            {row.raw[column] === "" ? (
                              <span className="text-ink-faint italic">empty</span>
                            ) : (
                              row.raw[column]
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <dl className="flex flex-col gap-1.5 px-3 py-2.5">
                  {row.reason && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                      <dt className="label shrink-0 sm:w-24">What was wrong</dt>
                      <dd className="text-sm leading-snug text-ink">{row.reason}</dd>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                    <dt className="label shrink-0 sm:w-24">What we did</dt>
                    <dd className="text-sm leading-snug text-ink-muted">
                      {row.action}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
