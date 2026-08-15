/**
 * `MasteryBar` — the five mastery states, drawn (M04 §2.3, §5.3, §8).
 *
 * This lives in `@ai/core` rather than in M04 by the same test the provenance
 * components pass: **"not tested is not zero" is a platform promise**, made by
 * FR-4.9, AC-4.2 and Rule 2, and rendered by five different surfaces. A
 * nineteenth copy is how it quietly stops being true in whichever repo falls
 * behind while that repo's own tests keep passing.
 *
 * Three rules the component ENFORCES rather than documents, because every
 * bar-chart component ever written violates the first one by default:
 *
 * 1. **A non-displayable state can never render a number.** `mastery_p` is
 *    ignored unless the state is one that has one. If an API ever sends
 *    `{state: "not_tested", mastery_p: 0}` — the exact regression AC-4.2
 *    guards — this renders "not tested yet", not an empty bar at zero.
 * 2. **State is text, never colour alone.** Every bar carries its word.
 * 3. **The three measured states differ by TEXTURE as well as hue**, so the
 *    difference survives greyscale and colour-blindness. "Just started" is
 *    hatched; it is not a third colour.
 *
 * And one the caller has to keep: a bar never disappears. Decay greys it and
 * says when it was last checked (`stale`), which is why there is no branch
 * here that returns null.
 */

import { shortDate } from "../lib/format";

export type MasteryState = "not_tested" | "emerging" | "weak" | "adequate" | "strong";

/** Mirrors `ai_core.mastery.MasteryView` as served by M04. */
export interface MasteryValue {
  concept_id: string;
  name: string;
  state: MasteryState;
  /** null unless the state is displayable. NEVER 0 for "we don't know". */
  mastery_p: number | null;
  n_direct: number;
  /** Decayed past the display ceiling, held open by hysteresis (§6.5). */
  stale?: boolean;
  last_evidence_at?: string | null;
  /** How many other concepts this one blocks — set only for a bottleneck. */
  blocks?: number;
}

/** The student-facing string. The enum name is never rendered: "weak" reads as
 *  a verdict on the person, "needs work" reads as a description of a topic. */
export const STATE_LABEL: Record<MasteryState, string> = {
  not_tested: "not tested yet",
  emerging: "just started",
  weak: "needs work",
  adequate: "solid",
  strong: "strong",
};

const DISPLAYABLE: MasteryState[] = ["weak", "adequate", "strong"];

/** Fill treatment per state. `emerging` is a texture, not a hue. */
const FILL: Record<MasteryState, string> = {
  not_tested: "",
  emerging: "mastery-hatch",
  weak: "bg-mastery-weak",
  adequate: "bg-mastery-ok",
  strong: "bg-mastery-strong",
};

const TRACK: Record<MasteryState, string> = {
  not_tested: "border border-dashed border-line-strong bg-transparent",
  emerging: "bg-surface-sunken",
  weak: "bg-surface-sunken",
  adequate: "bg-surface-sunken",
  strong: "bg-surface-sunken",
};

export function isDisplayable(state: MasteryState): boolean {
  return DISPLAYABLE.includes(state);
}

function fillWidth(value: MasteryValue): string {
  if (!isDisplayable(value.state)) {
    // "Just started" gets a fixed 20% sliver so the row has a shape without
    // implying a measurement. `not_tested` gets nothing at all.
    return value.state === "emerging" ? "20%" : "0%";
  }
  const p = value.mastery_p ?? 0;
  // Floor at 6%: a genuinely weak bar still has to be visible as a bar, or it
  // reads as "not tested" — which is the one confusion this component exists
  // to prevent.
  return `${Math.max(6, Math.round(p * 100))}%`;
}

/**
 * The suffix after the state word: how much we know, or when we last looked.
 * Counts, never percentages — at n = 2 a percentage fabricates precision.
 */
function detail(value: MasteryValue): string | null {
  if (value.stale && value.last_evidence_at) {
    return `not checked since ${shortDate(value.last_evidence_at)}`;
  }
  if (value.state === "not_tested") return null;
  if (value.blocks && value.blocks > 1) return `blocks ${value.blocks}`;
  return `tested ${value.n_direct}×`;
}

export function MasteryBar({
  value,
  width = "w-40",
  onClick,
}: {
  value: MasteryValue;
  /** Tailwind width class for the track. Full-width on mobile (§8). */
  width?: string;
  /** Tapping a bar opens the evidence drawer — Rule 3's escape hatch. */
  onClick?: () => void;
}) {
  const label = STATE_LABEL[value.state];
  const suffix = detail(value);
  const stale = Boolean(value.stale);

  const bar = (
    <span className={`inline-flex items-center gap-3 ${onClick ? "cursor-pointer" : ""}`}>
      <span
        aria-hidden="true"
        className={`h-2.5 shrink-0 overflow-hidden rounded-full ${width} ${TRACK[value.state]} ${
          stale ? "opacity-45" : ""
        }`}
      >
        {value.state !== "not_tested" && (
          <span
            className={`block h-full rounded-full ${FILL[value.state]}`}
            style={{ width: fillWidth(value) }}
          />
        )}
      </span>
      <span className={`text-xs ${stale ? "text-ink-faint" : "text-ink-soft"}`}>
        {label}
        {suffix && <span className="text-ink-faint"> · {suffix}</span>}
      </span>
    </span>
  );

  if (!onClick) return bar;

  return (
    <button
      type="button"
      onClick={onClick}
      // The accessible name carries the state as words, so a screen reader user
      // gets exactly what a sighted user gets and never a bare percentage.
      aria-label={`${value.name}: ${label}${suffix ? `, ${suffix}` : ""}. Show the evidence.`}
      className="rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {bar}
    </button>
  );
}

/**
 * The collapsed count for everything nobody has been asked about yet.
 *
 * At 120 concepts with 12 tested, a full grid is ~90% empty, and an empty grid
 * teaches a student the product is broken (§2.3). Never render an untested
 * concept as its own row — collapse the set to a count and a verb.
 */
export function NotYetTested({
  names,
  onStartCheck,
}: {
  names: string[];
  onStartCheck?: () => void;
}) {
  if (names.length === 0) return null;
  return (
    <section className="rounded-lg border border-line bg-surface-sunken/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Not yet tested ({names.length})</h3>
        {onStartCheck && (
          <button
            type="button"
            onClick={onStartCheck}
            className="text-xs font-medium text-brand hover:text-brand-hover"
          >
            Take a 15-min check →
          </button>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">{names.join(" · ")}</p>
    </section>
  );
}
