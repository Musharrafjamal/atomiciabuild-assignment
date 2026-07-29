"use client";

import type { LiveStatus } from "@/lib/client/use-live-shifts";
import { cx } from "./ui";

/**
 * Says whether the board is updating itself.
 *
 * Worth showing rather than hiding: a manager deciding whether a shift still
 * needs cover should be able to tell at a glance whether they are looking at
 * live data or a snapshot.
 */
export function LiveBadge({ status }: { status: LiveStatus }) {
  const config = {
    live: {
      label: "Live",
      title: "Updating as shifts change",
      dot: "bg-ok",
      pulse: true,
    },
    connecting: {
      label: "Connecting",
      title: "Reconnecting to live updates",
      dot: "bg-short",
      pulse: true,
    },
    polling: {
      label: "Auto-refresh",
      title: "Live updates unavailable; refreshing periodically",
      dot: "bg-ink-faint",
      pulse: false,
    },
  }[status];

  return (
    <span
      title={config.title}
      className="inline-flex items-center gap-1.5 rounded-[3px] border border-rule px-2 py-1"
    >
      <span className="relative flex size-1.5">
        {config.pulse && (
          <span
            className={cx(
              "absolute inline-flex size-full animate-ping rounded-full opacity-60",
              config.dot,
            )}
          />
        )}
        <span className={cx("relative inline-flex size-1.5 rounded-full", config.dot)} />
      </span>
      <span className="label !text-[9px]">{config.label}</span>
    </span>
  );
}
