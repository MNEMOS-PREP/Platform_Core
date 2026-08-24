/**
 * Provenance primitives — the platform's core UI contract (M15 §8).
 *
 * Rule 3 from plan_in_depth/README.md: *every number the user sees can be
 * traced to a thing they said or did. If you cannot show the evidence, do not
 * show the number.* These components are how that rule is kept.
 *
 * Accessibility: verification state is conveyed by TEXT and STRUCTURE, never by
 * colour or border alone. The community tray is a real <section> with a real
 * heading so it appears in the document outline.
 */

import { useId, useState } from "react";
import { relativeDays, shortDate } from "../lib/format";
import { Icon } from "./Icon";

export type VerificationState = "confirmed" | "reported" | "contested" | "rejected";
export type Stance = "fact" | "company_stated";

export interface ClaimSource {
  source_type: string;
  url: string | null;
  retrieved_at: string;
  excerpt: string;
}

export interface RenderedClaim {
  claim_id: string;
  block: string;
  text: string;
  structured: Record<string, unknown> | null;
  stance: Stance;
  verification_state: VerificationState;
  is_stale: boolean;
  corroboration_count: number;
  contradiction_count: number;
  freshest_source_at: string;
  age_days: number;
  sources: ClaimSource[];
}

const SOURCE_LABEL: Record<string, string> = {
  student_submission: "student report",
  placement_archive: "placement cell",
  official: "company official",
  web: "web",
};

/* ------------------------------------------------------------------ */
/*  Verification badge                                                 */
/* ------------------------------------------------------------------ */

export function VerificationBadge({
  state,
  count,
}: {
  state: VerificationState;
  count: number;
}) {
  const styles: Record<VerificationState, string> = {
    confirmed: "bg-confirmed-soft text-confirmed border-confirmed/30",
    reported: "bg-reported-soft text-reported border-reported/30",
    contested: "bg-contested-soft text-contested border-contested/30",
    rejected: "hidden",
  };
  const label: Record<VerificationState, string> = {
    confirmed: "Confirmed",
    reported: "Community reported",
    contested: "Reports disagree",
    rejected: "",
  };

  if (state === "rejected") return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[state]}`}
    >
      {label[state]}
      <span className="tabular opacity-70">
        · {count} {count === 1 ? "source" : "sources"}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Stale badge                                                        */
/* ------------------------------------------------------------------ */

export function StaleBadge({ since }: { since: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft">
      <Icon name="clock" size={12} /> from {shortDate(since)} — may have changed
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Source chip — hoverable/tappable, opens the full source list        */
/* ------------------------------------------------------------------ */

export function SourceChip({ sources }: { sources: ClaimSource[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  const freshest = sources
    .map((s) => s.retrieved_at)
    .sort()
    .at(-1)!;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-soft hover:border-brand hover:text-brand"
      >
        <Icon name="info" size={12} />
        {sources.length} {sources.length === 1 ? "source" : "sources"} ·{" "}
        {relativeDays(freshest)}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sources for this fact"
          className="absolute z-20 mt-1 w-80 rounded-lg border border-line bg-surface-raised p-3 text-left shadow-lg"
        >
          <p className="mb-2 text-xs font-semibold text-ink">Where this came from</p>
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li key={i} className="border-l-2 border-line pl-2 text-xs">
                <div className="font-medium text-ink">
                  {SOURCE_LABEL[s.source_type] ?? s.source_type}
                  <span className="ml-1 font-normal text-ink-faint">
                    · {shortDate(s.retrieved_at)}
                  </span>
                </div>
                {s.excerpt && (
                  <p className="mt-0.5 text-ink-soft italic">“{s.excerpt}”</p>
                )}
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand underline"
                  >
                    open source
                  </a>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 text-xs text-ink-faint underline"
          >
            close
          </button>
        </div>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  A single claim                                                     */
/* ------------------------------------------------------------------ */

export function ClaimRow({ claim }: { claim: RenderedClaim }) {
  return (
    <li className={`py-2 ${claim.is_stale ? "is-stale" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-ink">{claim.text}</span>
        <SourceChip sources={claim.sources} />
        {claim.is_stale && <StaleBadge since={claim.freshest_source_at} />}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Community tray — one-source facts live here, always                */
/* ------------------------------------------------------------------ */

export function CommunityTray({ claims }: { claims: RenderedClaim[] }) {
  /*
    Generated, not hardcoded.

    This id was the literal string "community-tray-heading", and a company page
    renders `CommunityTray` up to FOUR times — once for the process block and
    again inside the eligibility / compensation / tips loop. Four elements with
    one id is invalid HTML, and the consequence is not cosmetic: every
    `aria-labelledby` resolves to the FIRST match, so a screen reader announced
    the eligibility tray under the process section's heading. The docblock at
    the top of this file promises "the community tray is a real <section> with a
    real heading so it lands in the document outline"; with a duplicated id that
    promise was false as shipped, and it was false in the package whose job is
    to be the one implementation everybody trusts.
  */
  const headingId = useId();
  if (claims.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 rounded-lg border border-dashed border-reported/50 bg-reported-soft/40 p-3"
    >
      <h3
        id={headingId}
        className="text-xs font-semibold tracking-wide text-reported uppercase"
      >
        Community reported · single source each · treat with caution
      </h3>
      <p className="mt-1 text-xs text-ink-soft">
        Only one person has told us this. It may be true, it may be a one-off.
        We are showing it separately so it never looks like an established fact.
      </p>
      <ul className="mt-2 divide-y divide-line/60">
        {claims.map((c) => (
          <ClaimRow key={c.claim_id} claim={c} />
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Contested — both versions, side by side, with counts               */
/* ------------------------------------------------------------------ */

export function ContestedFact({ claims }: { claims: RenderedClaim[] }) {
  // Same duplication as `CommunityTray` above, for the same reason.
  const headingId = useId();
  if (claims.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 rounded-lg border border-contested/40 bg-contested-soft/40 p-3"
    >
      <h3 id={headingId} className="text-xs font-semibold text-contested uppercase">
        Reports disagree
      </h3>
      <p className="mt-1 text-xs text-ink-soft">
        Students told us different things. Reality is often contested; hiding
        that would be the lie. Both versions are below with their counts.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {claims.map((c) => (
          <div key={c.claim_id} className="rounded border border-line bg-surface-raised p-2">
            <p className="text-sm text-ink">{c.text}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="tabular text-xs text-ink-soft">
                {c.corroboration_count} for · {c.contradiction_count} against
              </span>
              <SourceChip sources={c.sources} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  "Company says" vs "Students report"                                */
/* ------------------------------------------------------------------ */

export function CompanySaysVsStudentsReport({
  companyClaims,
  studentClaims,
  ratings,
}: {
  companyClaims: RenderedClaim[];
  studentClaims: RenderedClaim[];
  ratings?: { aspect: string; mean: number; count: number }[];
}) {
  // Rendered twice on a company page (culture and growth), so both headings
  // need generated ids for the same reason the trays above do.
  const companyId = useId();
  const studentsId = useId();

  if (companyClaims.length === 0 && studentClaims.length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section
        aria-labelledby={companyId}
        className="rounded-lg border border-company/30 bg-company-soft/50 p-3"
      >
        <h3
          id={companyId}
          className="flex items-center gap-1.5 text-sm font-semibold text-company"
        >
          <Icon name="building" size={15} />
          Company says
        </h3>
        <p className="mt-0.5 text-xs text-ink-soft">
          Straight from their own material. Authoritative about what they
          <em> claim</em> — not evidence that it is true.
        </p>
        {companyClaims.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">Nothing on record yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {companyClaims.map((c) => (
              <li key={c.claim_id} className={c.is_stale ? "is-stale" : ""}>
                <p className="text-sm text-ink italic">“{c.text}”</p>
                <SourceChip sources={c.sources} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby={studentsId}
        className="rounded-lg border border-line bg-surface-raised p-3"
      >
        <h3
          id={studentsId}
          className="flex items-center gap-1.5 text-sm font-semibold text-ink"
        >
          <Icon name="student" size={15} />
          Students report
        </h3>
        <p className="mt-0.5 text-xs text-ink-soft">
          From people who actually sat the drive.
        </p>

        {ratings && ratings.length > 0 && (
          <dl className="mt-2 space-y-1">
            {ratings.map((r) => (
              <div key={r.aspect} className="flex items-baseline justify-between gap-2">
                <dt className="text-sm text-ink-soft capitalize">
                  {r.aspect.replace(/_/g, " ")}
                </dt>
                {/*
                  The number leads and the stars follow, because the number is
                  the claim and the stars are the gloss. Repeated "★" also
                  rounded 4.3 to four glyphs and 3.5 to four, so two visibly
                  different means drew the same row.
                */}
                <dd className="tabular flex items-center gap-1.5 text-sm text-ink">
                  <span>
                    {r.mean.toFixed(1)} out of 5
                    <span className="text-ink-faint"> · {r.count} ratings</span>
                  </span>
                  <span aria-hidden className="flex text-reported">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Icon
                        key={n}
                        name="star"
                        size={12}
                        className={n <= Math.round(r.mean) ? "" : "opacity-25"}
                      />
                    ))}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {studentClaims.length > 0 && (
          <ul className="mt-2 space-y-1">
            {studentClaims.map((c) => (
              <ClaimRow key={c.claim_id} claim={c} />
            ))}
          </ul>
        )}

        {studentClaims.length === 0 && (!ratings || ratings.length === 0) && (
          <p className="mt-2 text-sm text-ink-faint">
            No student reports on this yet.
          </p>
        )}
      </section>
    </div>
  );
}
