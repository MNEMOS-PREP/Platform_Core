/**
 * One page header, and loading that has a shape (v0.13.0).
 *
 * ── Why a header is a contract now ──────────────────────────────────────────
 * Shell.tsx says a module owns its own frame, and that stands: the rail, the
 * top bar and M15's company sections are chrome, and chrome is contextual. A
 * page's HEADER is not chrome. Mounted together in Platform_Shell, seven
 * modules opened their screens seven ways — a small uppercase label over a
 * display headline in one, a plain `h1` in the next, a mono eyebrow carrying
 * the module's number ("Skill graph · M04") in a third — and a paragraph of
 * rationale under most of them. A student moving between screens read that
 * as seven products. This is the one way a screen introduces itself:
 *
 *   · an optional eyebrow, in words a student uses (never a module code);
 *   · the title, one line;
 *   · ONE line of subtitle, saying what the screen is for;
 *   · actions on the right, and an optional row of figures under it;
 *   · the reasoning — why the numbers are what they are — folded into a
 *     "How this works" disclosure, there for whoever wants it and out of the
 *     way of whoever doesn't.
 *
 * ── Skeletons ───────────────────────────────────────────────────────────────
 * Rule 1 (Spinner) still holds: nothing loads nameless. A skeleton takes the
 * same required label, read to a screen reader, while sighted students see the
 * layout they are about to get rather than a sentence where it will be.
 */
import type { ReactNode } from "react";

import { Icon } from "./Icon";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  how,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One line. If it needs a second, the second belongs in `how`. */
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The reasoning behind the screen, folded away by default. */
  how?: ReactNode;
  /** A row under the header: figures, filters, a status pill. */
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-line pb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="text-sm font-medium text-ink-faint">{eyebrow}</p>}
          <h1 className="mt-1 text-title font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-[0.9375rem] text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
      {how && <HowItWorks>{how}</HowItWorks>}
    </header>
  );
}

/** The paragraph a screen used to open with, one click away. */
export function HowItWorks({
  label = "How this works",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-faint hover:text-ink-soft [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" size={13} className="transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="mt-2 max-w-2xl space-y-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}

/** One grey block, sweeping. Sized by the caller to match what replaces it. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

/**
 * A placeholder in the shape of a list of rows: what most screens load into.
 * `label` is required for the same reason Spinner's is.
 */
export function SkeletonRows({
  label,
  rows = 5,
  className = "",
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={`h-3.5 ${i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-3/5" : "w-1/2"}`} />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** A placeholder in the shape of a card grid. */
export function SkeletonCards({
  label,
  cards = 3,
  className = "",
}: {
  label: string;
  cards?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${className}`}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="panel space-y-3 p-5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
