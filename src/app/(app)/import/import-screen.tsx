"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { ImportReportSummaryView } from "@/lib/api/views";
import { ApiFailure, api } from "@/lib/client/api";
import { formatClinicDate } from "@/lib/time";
import { Button, Empty, Notice, cx } from "@/components/ui";
import { OutcomeBadge, OutcomeBar } from "@/components/import-report";

/**
 * Upload a CSV and browse past import reports.
 *
 * The upload goes through exactly the pipeline the seed uses, so the report a
 * manager gets here has the same shape and the same rules as the one produced
 * when the database was first populated.
 */
export function ImportScreen() {
  const { data, mutate, isLoading } = useSWR<{
    reports: ImportReportSummaryView[];
  }>("/api/import", api.get);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justImported, setJustImported] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setJustImported(null);

    try {
      const body = new FormData();
      body.append("file", file);
      // Not via the JSON helper: this is multipart, and setting Content-Type by
      // hand would omit the boundary.
      const response = await fetch("/api/import", { method: "POST", body });
      const payload = await response.json();

      if (!response.ok) {
        throw new ApiFailure(
          payload?.error?.code ?? "INTERNAL",
          payload?.error?.message ?? "That import failed.",
          response.status,
        );
      }

      setJustImported(payload.report.id);
      await mutate();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "That import failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const reports = data?.reports ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="label">Data</div>
        <h1 className="display mt-1.5 text-[clamp(1.75rem,4vw,2.75rem)] text-ink">
          Import
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Upload a staff or shifts CSV. Every row is accounted for: what was
          accepted, what was merged with a duplicate, what clashed, and what was
          rejected — with the original row and the reason in each case.
        </p>
      </header>

      {/* ---- Upload ---- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className={cx(
          "flex flex-col items-center gap-3 rounded-[3px] border border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-ink bg-paper-inset"
            : "border-rule-strong bg-paper-sunken/40",
        )}
      >
        <p className="text-sm font-medium text-ink">
          Drop a CSV here, or choose a file
        </p>
        <p className="max-w-md text-xs leading-relaxed text-ink-faint">
          A staff file needs a <span className="numeric">staff_id</span> column; a
          shifts file needs <span className="numeric">shift_id</span>. The type is
          detected from the header, so there is nothing to select.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <Button
          variant="solid"
          busy={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Importing…" : "Choose CSV"}
        </Button>
      </div>

      {error && <Notice>{error}</Notice>}
      {justImported && (
        <Notice tone="success">
          Import finished.{" "}
          <Link className="underline underline-offset-2" href={`/import/${justImported}`}>
            Open the report
          </Link>
          .
        </Notice>
      )}

      {/* ---- History ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="label">Reports</h2>

        {isLoading ? (
          <div className="h-24 animate-pulse rounded-[3px] bg-paper-inset" />
        ) : reports.length === 0 ? (
          <Empty title="No imports yet" body="Upload a CSV to see a report here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((report) => (
              <li key={report.id}>
                <Link
                  href={`/import/${report.id}`}
                  className="block rounded-[3px] border border-rule bg-paper-raised px-4 py-3 transition-colors hover:border-ink"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-ink">
                      {report.filename}
                    </span>
                    <span className="label">
                      {report.kind} · {report.source}
                    </span>
                    <span className="numeric ml-auto text-xs text-ink-faint">
                      {formatClinicDate(report.createdAt, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <div className="mt-2.5">
                    <OutcomeBar summary={report.summary} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <OutcomeBadge outcome="accepted" count={report.summary.accepted} />
                    <OutcomeBadge outcome="merged" count={report.summary.merged} />
                    <OutcomeBadge outcome="conflict" count={report.summary.conflict} />
                    <OutcomeBadge outcome="rejected" count={report.summary.rejected} />
                    <span className="numeric ml-1 text-xs text-ink-faint">
                      of {report.summary.total} rows
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
