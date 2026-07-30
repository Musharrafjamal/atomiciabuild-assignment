"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Notice, inputClass } from "@/components/ui";

/**
 * The interactive half of the login screen.
 *
 * Split out from `page.tsx` deliberately. This used to be one client component
 * that read `?next=` with `useSearchParams()`, which forced the whole page out
 * of prerendering (`BAILOUT_TO_CLIENT_SIDE_RENDERING`) and shipped an empty
 * body -- the first screen anyone sees was blank until the bundle hydrated.
 *
 * The `next` parameter is now read from `window.location` inside the submit
 * handler instead. It is only ever needed at the moment of navigation, never
 * during render, so nothing has to be known on the server and the surrounding
 * page stays static HTML.
 */

/**
 * Only same-origin paths are honoured.
 *
 * `next` comes from the query string, so it is attacker-controllable: without
 * this a crafted `/login?next=https://…` would turn the sign-in form into an
 * open redirect, and `//host` is protocol-relative, which browsers resolve as
 * absolute. Anything that is not a plain rooted path is discarded.
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function LoginForm() {
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

      const wanted = safeNext(
        new URLSearchParams(window.location.search).get("next"),
      );
      const next =
        wanted ?? (data.user.role === "manager" ? "/dashboard" : "/shifts");

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
    <>
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
    </>
  );
}
