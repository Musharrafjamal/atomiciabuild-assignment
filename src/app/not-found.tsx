import Link from "next/link";

/**
 * Shown for an unmatched URL, in place of Next's stock 404.
 *
 * A Server Component with no interactivity, so it costs no JavaScript. The link
 * points at `/`, which reads the session and forwards a manager to the
 * dashboard and everyone else to their shifts -- so "back to the rota" lands on
 * the right screen without this page needing to know who is signed in.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-md">
        <div className="label">Clinic Rota</div>

        <h1 className="display mt-3 text-4xl text-ink">
          That page does not exist.
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          The address may be mistyped, or the shift it pointed at may have been
          deleted.
        </p>

        <Link
          href="/"
          className="mt-7 inline-flex h-9 items-center justify-center rounded-[3px] border border-ink bg-ink px-3.5 text-sm font-medium text-paper transition-colors hover:border-ink-muted hover:bg-ink-muted"
        >
          Back to the rota
        </Link>
      </div>
    </main>
  );
}
