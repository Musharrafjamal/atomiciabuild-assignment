"use client";

import { useEffect, useRef, useState } from "react";

export type LiveStatus = "connecting" | "live" | "polling";

/**
 * Keeps the current week fresh without a refresh.
 *
 * Subscribes to /api/stream and calls `onChange` when a shift changes anywhere.
 * The caller revalidates its own data, so this hook never has to merge partial
 * updates — the server stays the single source of truth for what a week
 * contains.
 *
 * `EventSource` reconnects by itself, and the server closes the stream before
 * the platform's function timeout would. Each reconnect fires a `ready` event,
 * which triggers a revalidation so nothing that happened during the gap is
 * missed.
 *
 * If the stream cannot be established at all — the endpoint reports the database
 * does not support change streams, or the connection keeps failing — the hook
 * gives up and reports `polling`, and the caller falls back to an interval. Live
 * updates are a nicety; a stale board is not acceptable either way.
 */
const DISABLED = process.env.NEXT_PUBLIC_DISABLE_LIVE === "true";

export function useLiveShifts(
  onChange: (shiftId: string | null) => void,
): LiveStatus {
  // Known before the first render, so it belongs in the initial state rather
  // than in an effect that would render once and then immediately correct itself.
  const [status, setStatus] = useState<LiveStatus>(
    DISABLED ? "polling" : "connecting",
  );

  // Held in a ref so reconnecting does not depend on the callback's identity,
  // which would otherwise tear down and rebuild the stream on every render.
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (DISABLED) return;

    let source: EventSource | null = null;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource("/api/stream");

      source.addEventListener("ready", () => {
        failures = 0;
        setStatus("live");
        // Catch up on anything that changed while reconnecting. No specific
        // shift to point at, so nothing is highlighted.
        handler.current(null);
      });

      source.addEventListener("shift", (event) => {
        let id: string | null = null;
        try {
          id = JSON.parse((event as MessageEvent).data)?.id ?? null;
        } catch {
          /* a malformed frame still means 'something changed' */
        }
        handler.current(id);
      });

      source.addEventListener("unsupported", () => {
        stopped = true;
        source?.close();
        setStatus("polling");
      });

      source.onerror = () => {
        source?.close();
        if (stopped) return;

        failures += 1;
        if (failures >= 4) {
          setStatus("polling");
          return;
        }
        setStatus("connecting");
        // EventSource reconnects on its own, but the server ends each stream
        // deliberately; backing off avoids hammering a genuinely broken endpoint.
        retry = setTimeout(connect, Math.min(1000 * 2 ** failures, 15_000));
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);

  return status;
}
