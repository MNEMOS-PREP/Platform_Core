/** App chrome and small shared states. */

import { Link, NavLink } from "react-router-dom";
import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="font-semibold text-ink">
            AI Interviewer
          </Link>
          <nav className="flex gap-4 text-sm" aria-label="Main">
            <NavLink
              to="/companies"
              className={({ isActive }) =>
                isActive ? "text-brand font-medium" : "text-ink-soft hover:text-ink"
              }
            >
              Companies
            </NavLink>
            <NavLink
              to="/modules"
              className={({ isActive }) =>
                isActive ? "text-brand font-medium" : "text-ink-soft hover:text-ink"
              }
            >
              All modules
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-ink-faint">
        Every fact on this site shows where it came from and when. If something
        looks wrong, tell us — that is how it gets fixed.
      </footer>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  // Rule 1: never a bare spinner. Always say *what* is happening.
  return (
    <p role="status" className="py-8 text-center text-sm text-ink-soft">
      {label}
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-contested/40 bg-contested-soft/40 p-4">
      <p className="text-sm text-ink">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-line bg-surface-raised px-3 py-1 text-sm hover:border-brand"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Card({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface-raised p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-ink">
          {icon && <span aria-hidden>{icon} </span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ModulePlaceholder({ id, name }: { id: string; name: string }) {
  return (
    <Layout>
      <div className="rounded-lg border border-dashed border-line p-8 text-center">
        <p className="text-sm font-medium text-ink-soft">
          {id} — {name}
        </p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Not built yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          This module is specified in <code>plan_in_depth/{id}_*.md</code> and has
          a backend package and a frontend folder waiting for it. Showing you an
          honest placeholder is better than a broken screen.
        </p>
        <Link
          to="/companies"
          className="mt-4 inline-block rounded bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Try the Company Guider instead
        </Link>
      </div>
    </Layout>
  );
}
