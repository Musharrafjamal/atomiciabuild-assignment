import { LoginForm } from "./login-form";

/**
 * The sign-in screen.
 *
 * A Server Component on purpose. Everything here -- the editorial panel, the
 * headline, the labels -- is static markup, so it prerenders and is on screen
 * before any JavaScript arrives; only the form itself is a Client Component.
 *
 * The earlier version made the whole page a client component so it could read
 * `?next=` with `useSearchParams()`. That call inside a Suspense boundary opts
 * the subtree out of prerendering, and because the boundary had no fallback the
 * deployed page served an empty body -- a blank screen until the bundle loaded.
 * `next` is now read at submit time in `login-form.tsx`, which is the only
 * moment it matters.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* Editorial panel. Hidden on phones, where it would just cost a scroll. */}
      <aside className="relative hidden overflow-hidden border-r border-rule bg-paper-sunken lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-12">
        <div className="label">Clinic Rota</div>

        <div className="rise">
          <h1 className="display text-[clamp(3rem,6vw,5.25rem)] text-ink">
            Who is
            <br />
            on today.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-ink-muted">
            Shifts, claims and coverage for the whole clinic — replacing the
            spreadsheet that nobody trusted.
          </p>
        </div>

        {/* A miniature of the coverage language used throughout the app. */}
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[
            { label: "Fully staffed", cls: "bg-ok", w: "w-full" },
            { label: "Short", cls: "bg-short", w: "w-2/3" },
            { label: "Nobody yet", cls: "bg-empty", w: "w-1/4" },
          ].map((row, i) => (
            <div
              key={row.label}
              className="rise flex items-center gap-3"
              style={{ animationDelay: `${140 + i * 90}ms` }}
            >
              <div className="h-1 w-28 bg-rule">
                <div className={`h-full ${row.cls} ${row.w}`} />
              </div>
              <span className="label">{row.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex flex-1 items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <div className="label">Clinic Rota</div>
            <h1 className="display mt-3 text-4xl text-ink">Who is on today.</h1>
          </div>

          <h2 className="mt-8 text-lg font-semibold tracking-tight text-ink lg:mt-0">
            Sign in
          </h2>
          <p className="mt-1 text-sm text-ink-faint">
            Use your clinic email address.
          </p>

          <LoginForm />
        </div>
      </div>
    </main>
  );
}
