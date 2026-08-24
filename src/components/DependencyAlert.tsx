/**
 * Missing-module alerts.
 *
 * When an upstream module is not running, the feature that needed it is
 * switched off — but never silently. The student sees which part is missing,
 * which module it needs, and that the rest of the page is unaffected.
 *
 * This is Rule 1 ("the user is never confused about what is happening") and
 * Rule 2 ("a missing input is never a low score") applied to services. An
 * empty box teaches a student that the product is broken; a sentence teaches
 * them that one piece is unavailable and the rest is trustworthy.
 */

import { useId, type ReactNode } from "react";

import { Icon } from "./Icon";

export interface DegradedFeature {
  feature: string;
  needs_module: string;
  needs_module_name: string;
  explanation: string;
}

export interface DependencyStatus {
  module_id: string;
  name: string;
  available: boolean;
  required: boolean;
  reason: string;
  on_missing: string;
  base_url: string;
  checked_at: string;
  detail: string;
}

/**
 * Page-level banner listing everything currently switched off.
 *
 * Render near the top, above the affected sections. Renders nothing when
 * nothing is degraded, so it is always safe to include.
 */
export function DependencyAlert({
  degraded,
  compact = false,
}: {
  degraded: DegradedFeature[] | undefined;
  compact?: boolean;
}) {
  const headingId = useId();
  if (!degraded || degraded.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-reported/50 bg-reported-soft/40 p-3"
    >
      {/*
        `h3`, not `h2`. This banner is rendered INSIDE a page section that is
        already an `h2`, so a second `h2` put a sibling where a child belongs and
        the document outline stopped matching the page. It is a note about the
        section it sits in, not a peer of it.
      */}
      <h3
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold text-reported"
      >
        <Icon name="alert" size={15} />
        {degraded.length === 1
          ? "One part of this page is unavailable"
          : `${degraded.length} parts of this page are unavailable`}
      </h3>

      {!compact && (
        <p className="mt-1 text-xs text-ink-soft">
          Everything else here is unaffected — we would rather tell you what is
          missing than quietly show you less.
        </p>
      )}

      <ul className="mt-2 space-y-1.5">
        {degraded.map((d) => (
          <li key={`${d.needs_module}-${d.feature}`} className="text-sm">
            <span className="font-medium text-ink">{d.feature}</span>
            <span className="text-ink-soft">
              {" — needs "}
              <span className="rounded border border-line bg-surface px-1 py-0.5 text-xs">
                {d.needs_module} {d.needs_module_name}
              </span>
              , which isn't running.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Inline replacement for a single section that could not be built.
 *
 * Use this *in place of* the section, not next to an empty one — a gap with no
 * explanation is the failure mode this component exists to prevent.
 */
export function DegradedSection({
  title,
  icon,
  needs,
  children,
}: {
  title: string;
  icon?: string;
  needs: DegradedFeature | { needs_module: string; needs_module_name: string };
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-dashed border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink-soft">
        {icon && <span aria-hidden>{icon} </span>}
        {title}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Unavailable right now — this needs{" "}
        <strong className="text-ink">
          {needs.needs_module} {needs.needs_module_name}
        </strong>
        , which isn't running.
      </p>
      {children && <div className="mt-2 text-sm text-ink-soft">{children}</div>}
    </section>
  );
}

/**
 * Developer-facing dependency table.
 *
 * Mount behind a dev route or an admin page. Answers "why is this page thin?"
 * in one glance instead of a console dig.
 */
export function DependencyTable({ statuses }: { statuses: DependencyStatus[] }) {
  if (statuses.length === 0) {
    return <p className="text-sm text-ink-soft">This module declares no dependencies.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs tracking-wide text-ink-soft uppercase">
          <th className="py-2 pr-3">Module</th>
          <th className="py-2 pr-3">Status</th>
          <th className="py-2 pr-3">Used for</th>
          <th className="py-2">If missing</th>
        </tr>
      </thead>
      <tbody>
        {statuses.map((s) => (
          <tr key={s.module_id} className="border-b border-line/60 align-top">
            <td className="py-2 pr-3 whitespace-nowrap">
              <span className="font-medium text-ink">{s.module_id}</span>{" "}
              <span className="text-ink-soft">{s.name}</span>
              {s.required && (
                <span className="ml-1 rounded bg-contested-soft px-1 text-xs text-contested">
                  required
                </span>
              )}
            </td>
            <td className="py-2 pr-3">
              {s.available ? (
                <span className="rounded-full border border-confirmed/30 bg-confirmed-soft px-2 py-0.5 text-xs text-confirmed">
                  up
                </span>
              ) : (
                <span className="rounded-full border border-reported/30 bg-reported-soft px-2 py-0.5 text-xs text-reported">
                  down
                </span>
              )}
              <div className="mt-0.5 text-xs text-ink-faint">{s.detail}</div>
              <div className="text-xs text-ink-faint">{s.base_url || "no base_url"}</div>
            </td>
            <td className="py-2 pr-3 text-ink-soft">{s.reason}</td>
            <td className="py-2 text-ink-soft">{s.on_missing}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
