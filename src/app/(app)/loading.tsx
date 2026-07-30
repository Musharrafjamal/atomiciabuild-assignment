/**
 * The instant loading state for every authenticated screen.
 *
 * The layout above this reads the session, so there is always a moment before a
 * screen can render. Without a `loading.tsx` that moment is an empty content
 * area below an already-painted nav bar, which reads as a broken page rather
 * than a loading one.
 *
 * It deliberately mirrors the coverage board's real geometry -- title block,
 * summary strip, then day columns -- so the page does not visibly reflow when
 * the data arrives. Server Component, so it costs no JavaScript.
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <span className="sr-only" aria-hidden="false" role="status">
        Loading…
      </span>

      {/* Title and week controls */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <div className="h-2.5 w-16 rounded-[2px] bg-paper-inset" />
          <div className="mt-3 h-9 w-72 max-w-full rounded-[3px] bg-paper-inset" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-20 rounded-[3px] bg-paper-inset" />
          <div className="h-9 w-24 rounded-[3px] bg-paper-inset" />
          <div className="h-9 w-32 rounded-[3px] bg-paper-inset" />
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-paper-raised px-4 py-3.5">
            <div className="h-2.5 w-14 rounded-[2px] bg-paper-inset" />
            <div className="mt-2.5 h-6 w-10 rounded-[2px] bg-paper-inset" />
          </div>
        ))}
      </div>

      {/* Day columns, collapsing to a single agenda column exactly as the board does */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, day) => (
          <div key={day} className="flex flex-col gap-2">
            <div className="h-2.5 w-20 rounded-[2px] bg-paper-inset" />
            {Array.from({ length: day % 3 === 0 ? 3 : 2 }, (_, card) => (
              <div
                key={card}
                className="relative overflow-hidden border border-rule bg-paper-raised px-3 py-3"
              >
                <span className="absolute inset-y-0 left-0 w-[3px] bg-paper-inset" />
                <div className="h-3 w-24 rounded-[2px] bg-paper-inset" />
                <div className="mt-2.5 h-2.5 w-16 rounded-[2px] bg-paper-inset" />
                <div className="mt-3 h-4 w-20 rounded-[3px] bg-paper-inset" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
