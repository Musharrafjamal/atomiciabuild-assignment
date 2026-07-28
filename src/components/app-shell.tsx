"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "./ui";
import type { SessionPayload } from "@/lib/auth/token";

const MANAGER_NAV = [
  { href: "/dashboard", label: "Coverage" },
  { href: "/shifts", label: "Shifts" },
  { href: "/import", label: "Import" },
];

const STAFF_NAV = [{ href: "/shifts", label: "My shifts" }];

export function AppShell({
  user,
  children,
}: {
  user: SessionPayload;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = user.role === "manager" ? MANAGER_NAV : STAFF_NAV;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-3 px-4 sm:px-6">
          <Link href={nav[0].href} className="flex shrink-0 items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink">
              Clinic Rota
            </span>
          </Link>

          <nav className="ml-2 flex items-center gap-0.5 overflow-x-auto">
            {nav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "whitespace-nowrap rounded-[3px] px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-paper-inset font-medium text-ink"
                      : "text-ink-muted hover:bg-paper-inset hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-xs font-medium text-ink">{user.name}</div>
              <div className="label">{user.profession ?? user.role}</div>
            </div>
            <SignOut />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

function SignOut() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.assign("/login");
      }}
      className="rounded-[3px] border border-rule-strong px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-ink hover:text-ink"
    >
      Sign out
    </button>
  );
}
