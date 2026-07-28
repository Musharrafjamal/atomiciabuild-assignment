"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * The small set of primitives every screen is built from.
 *
 * Deliberately hand-written rather than pulled from a component library: the
 * whole visual argument here is hairline rules, tabular numerals and colour
 * reserved for staffing status, and a generic library would have to be fought
 * on all three.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type Variant = "solid" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  solid:
    "bg-ink text-paper border-ink hover:bg-ink-muted hover:border-ink-muted disabled:bg-ink-faint disabled:border-ink-faint",
  outline:
    "bg-paper-raised text-ink border-rule-strong hover:border-ink hover:bg-paper-inset",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-paper-inset hover:text-ink",
  danger:
    "bg-transparent text-empty border-empty-edge hover:bg-empty-bg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "outline", size = "md", busy, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 border font-medium",
        "transition-colors duration-150 select-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" ? "h-7 px-2.5 text-xs rounded-[3px]" : "h-9 px-3.5 text-sm rounded-[3px]",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

function Spinner() {
  return (
    <svg
      className="size-3 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export const inputClass = cx(
  "h-9 w-full rounded-[3px] border border-rule-strong bg-paper-raised px-2.5",
  "text-sm text-ink placeholder:text-ink-faint",
  "transition-colors focus:border-focus focus:outline-none focus-visible:outline-none",
);

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Inline, next to the thing that failed -- not a toast that slides away before
 * a busy person has read why their claim was refused.
 */
export function Notice({
  tone = "error",
  children,
}: {
  tone?: "error" | "info" | "success";
  children: ReactNode;
}) {
  const tones = {
    error: "border-empty-edge bg-empty-bg text-empty",
    info: "border-rule-strong bg-paper-inset text-ink-muted",
    success: "border-ok-edge bg-ok-bg text-ok",
  } as const;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-[3px] border px-3 py-2 text-sm leading-snug",
        tones[tone],
      )}
    >
      {children}
    </div>
  );
}

export function Spread({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 border border-dashed border-rule-strong bg-paper-sunken/50 px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-faint">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
