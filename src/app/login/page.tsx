"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, Notice, inputClass } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);

  /*
   * Marks the form as hydrated once React has taken over.
   *
   * Set imperatively rather than through state: this is a signal for the
   * end-to-end tests, not something the UI renders from, and driving a render
   * from it would be a cascading-render smell.
   */
  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.error?.message ?? "Could not sign in.");
        return;
      }

      const next =
        params.get("next") ??
        (data.user.role === "manager" ? "/dashboard" : "/shifts");
      // Full navigation so the proxy re-reads the freshly set cookie.
      window.location.assign(next);
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setBusy(false);
    }
  }

  function fill(as: "manager" | "staff") {
    setEmail(as === "manager" ? "manager@clinic.test" : "ivy.bell@clinicmail.test");
    setPassword(as === "manager" ? "manager1234" : "staff1234");
    setError(null);
  }

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

          <form
            ref={formRef}
            /*
             * method="post" matters even though this handler always calls
             * preventDefault. Before hydration the form is plain HTML, and the
             * default GET submission would put the typed password into the URL
             * and the browser history. A POST cannot leak it that way.
             */
            method="post"
            onSubmit={submit}
            className="mt-7 flex flex-col gap-4"
          >
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@clinicmail.test"
              />
            </Field>

            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {error && <Notice>{error}</Notice>}

            <Button type="submit" variant="solid" busy={busy} className="mt-1 h-10">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-8 border-t border-rule pt-5">
            <p className="label">Demo logins</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => fill("manager")} type="button">
                Manager
              </Button>
              <Button size="sm" onClick={() => fill("staff")} type="button">
                Nurse
              </Button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Every seeded staff account uses the password{" "}
              <span className="numeric text-ink-muted">staff1234</span>. The full
              roster is in the README.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
