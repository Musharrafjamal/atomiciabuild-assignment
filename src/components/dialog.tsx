"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Built on the native `<dialog>` element rather than a portal-and-overlay of our
 * own: focus trapping, Escape to close, inertness of the page behind, and the
 * top layer all come from the platform. That is a lot of accessibility we would
 * otherwise have to write and get subtly wrong.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicking the backdrop closes. The check compares against the dialog box
      // itself, so clicks on the content do not bubble into a close.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100vw-2rem)] rounded-[4px] border border-rule-strong bg-paper p-0",
        "text-ink shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]",
        "backdrop:bg-black/45 backdrop:backdrop-blur-[2px]",
        "open:animate-[rise_0.2s_cubic-bezier(0.2,0.7,0.3,1)]",
        width === "lg" ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {description && (
                <p className="mt-0.5 text-sm text-ink-faint">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded-[3px] p-1.5 text-ink-faint transition-colors hover:bg-paper-inset hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-paper-sunken px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
