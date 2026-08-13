/**
 * App chrome and shared states.
 *
 * Used by every module, so the platform looks like one product rather than
 * nineteen student projects stapled together.
 */

import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export interface NavItem {
  to: string;
  label: string;
}

export function Layout({
  children,
  nav,
  moduleLabel,
}: {
  children: ReactNode;
  nav?: NavItem[];
  /** e.g. "M15 · Company Guider" — shown small, for orientation while building. */
  moduleLabel?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-8 px-5">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight text-ink"
          >
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-sm font-bold text-white"
            >
              ai
            </span>
            <span className="hidden sm:inline">AI Interviewer</span>
          </Link>

          {nav && nav.length > 0 && (
            <nav aria-label="Main" className="flex items-center gap-1">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-brand-soft text-brand"
                        : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
                    ].join(" ")
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}

          {moduleLabel && (
            <span className="ml-auto hidden rounded-md border border-line px-2 py-0.5 font-mono text-2xs text-ink-faint md:inline">
              {moduleLabel}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>

      <footer className="border-t border-line">
        <p className="mx-auto max-w-5xl px-5 py-6 text-xs text-ink-faint">
          Every fact here shows where it came from and when. If something looks
          wrong, tell us — that is how it gets fixed.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

/**
 * Rule 1: never a bare spinner. The label is required, not optional — a
 * spinner with no name teaches the student nothing about what is happening.
 */
export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16">
      <span
        aria-hidden
        className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand"
      />
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  );
}

export function ErrorNote({
  message,
  onRetry,
  detail,
}: {
  message: string;
  onRetry?: () => void;
  detail?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-contested-line bg-contested-soft p-4"
    >
      <p className="text-sm font-medium text-ink">{message}</p>
      {detail && <p className="mt-1 font-mono text-xs text-ink-soft">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-line-strong"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Containers                                                         */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  icon,
  eyebrow,
  children,
  action,
  meta,
}: {
  title?: string;
  icon?: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  /** Small right-aligned context, e.g. "11 reports · Aug 24–Jan 25". */
  meta?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-card">
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && (
              <h2 className="flex items-center gap-2 font-semibold text-ink">
                {icon && (
                  <span aria-hidden className="text-base">
                    {icon}
                  </span>
                )}
                {title}
              </h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {meta && <span className="text-xs text-ink-faint">{meta}</span>}
            {action}
          </div>
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-hover",
    secondary: "border border-line bg-surface text-ink hover:border-line-strong",
    ghost: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
  };
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm" };
  return (
    <button {...props} className={`${base} ${variants[variant]} ${sizes[size]}`}>
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  children,
  action,
  icon = "🔍",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <h2 className="mt-3 font-semibold text-ink">{title}</h2>
      {children && (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{children}</div>
      )}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ModulePlaceholder({ id, name }: { id: string; name: string }) {
  return (
    <Layout moduleLabel={`${id} · ${name}`}>
      <EmptyState icon="🧱" title="Not built yet">
        <p>
          {id} — {name} is specified in{" "}
          <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs">
            plan_in_depth/{id}_*.md
          </code>{" "}
          and has a package waiting for it. An honest placeholder beats a broken
          screen.
        </p>
      </EmptyState>
    </Layout>
  );
}
