"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * The fallback for an unhandled render or data error.
 *
 * Without this file a thrown error drops the visitor onto Next's stock error
 * screen, which shares nothing with the rest of the application. `error.tsx`
 * must be a Client Component -- it is a React error boundary.
 *
 * `unstable_retry` re-fetches and re-renders the segment, which is what this
 * app actually needs: almost anything that fails here is a database round trip,
 * and those are usually worth simply trying again. (`reset` only clears the
 * boundary's state without re-fetching, so a failed query would just fail
 * again.) The name is Next's, not a marker of instability on our side.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The platform captures this; in production the message is redacted and the
    // digest is the only way to line it up with the server-side log.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-md">
        <div className="label">Clinic Rota</div>

        <h1 className="display mt-3 text-4xl text-ink">
          Something went wrong.
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          The page could not be loaded. This is usually temporary — trying again
          is worth a go before anything else.
        </p>

        {error.digest && (
          <p className="mt-4 border-t border-rule pt-4 text-xs text-ink-faint">
            Reference{" "}
            <span className="numeric text-ink-muted">{error.digest}</span> — quote
            this if you report it.
          </p>
        )}

        <div className="mt-7 flex flex-wrap gap-2">
          <Button variant="solid" onClick={() => unstable_retry()}>
            Try again
          </Button>
          <Button onClick={() => window.location.assign("/")}>
            Back to the rota
          </Button>
        </div>
      </div>
    </main>
  );
}
