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
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
          {/*
            The wordmark is hidden on the narrowest screens. At 375px it, the
            three nav tabs and the sign-out control cannot all fit, and the tabs
            identify the app perfectly well on their own -- clipping "Import" to
            keep a logo would be the wrong trade.
          */}
          <Link
            href={nav[0].href}
            className="hidden shrink-0 items-baseline gap-2 sm:flex"
          >
            <span className="text-sm font-semibold tracking-tight text-ink">
              Clinic Rota
            </span>
          </Link>

          <nav className="scroll-x -mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 sm:ml-2">
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
      aria-label="Sign out"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.assign("/login");
      }}
      className="shrink-0 whitespace-nowrap rounded-[3px] border border-rule-strong px-2 py-1.5 text-xs text-ink-muted transition-colors hover:border-ink hover:text-ink sm:px-2.5"
    >
      {/* "Sign out" wraps to two lines at 375px; the icon carries it there. */}
      <span className="hidden sm:inline">Sign out</span>
      <svg
        className="sm:hidden"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 8l-3.5-3M14 8H6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
