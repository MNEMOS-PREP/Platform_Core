/**
 * Shared STATES. Chrome is the module's job.
 *
 * ── The decision this file used to dodge ────────────────────────────────────
 * `Layout` lived here, with a docblock saying it existed "so the platform looks
 * like one product rather than nineteen student projects stapled together". It
 * was imported by nothing. The only module that exists ignored it and built its
 * own `AppShell`, and the two disagreed on every value — 12px radius against
 * 10, `px-4 py-2` buttons against `px-3.5 py-1.5`, `max-w-5xl` against
 * `max-w-4xl`, `shadow-card` against a hairline. The one-product promise had
 * already failed at n = 1, and keeping a dead component that asserts otherwise
 * is worse than not having one.
 *
 * So it is settled, and written down: **a module owns its own frame.** M15's
 * chrome carries the current COMPANY and that company's sections, which is real
 * navigation rather than decoration, and no shared `Layout` can know that. What
 * makes the platform one product is the vocabulary underneath the frame — the
 * provenance components, the mastery bar, the icon set, the tokens — all of
 * which live here and are versioned.
 *
 * What remains in this file is the set of shared STATES, which genuinely are a
 * contract: a spinner that cannot be nameless, an error note, an empty state,
 * a card and a button for a module that has not yet grown its own. If you find
 * yourself fighting `Card` or `Button` to make a screen look right, that is the
 * signal to write the module's own primitive — not to add a variant here.
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

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
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <Icon name="alert" size={15} className="text-contested" />
        {message}
      </p>
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
  /** A name from the icon set. It was `string`, and every caller passed an emoji. */
  icon?: IconName;
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
                {icon && <Icon name={icon} size={17} className="text-ink-faint" />}
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
    // `text-on-brand`, never `text-white`. Dark mode lightens `--color-brand`
    // to 0.72 because that is correct for a LINK on a dark canvas; white on
    // that is 2.51:1, and every primary action in the product was illegible in
    // the theme students use at night. The label travels with the fill now.
    primary: "bg-brand text-on-brand hover:bg-brand-hover",
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
  icon = "search",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <Icon name={icon} size={22} className="mx-auto text-ink-faint" />
      {/*
        `h3`. This is an empty STATE inside a section, not a peer of the page
        heading, and it was an `h2` — so an empty list put a second top-level
        heading into the outline of whatever section it was standing in for.
      */}
      <h3 className="mt-3 font-semibold text-ink">{title}</h3>
      {children && (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{children}</div>
      )}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
