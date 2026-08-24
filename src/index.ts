/**
 * `@ai/core` — shared frontend foundation for the AI Interviewer platform.
 *
 * Imported by every module frontend. The provenance components in particular
 * are a PLATFORM CONTRACT, not module code: they define what a sourced fact
 * looks like everywhere. If each module owned a copy they would drift, and
 * "every fact shows its source" would quietly stop being true in whichever
 * module fell behind — while that module's own tests kept passing.
 *
 * That is the whole reason this package exists as a versioned dependency
 * rather than a folder you copy.
 */

/**
 * Must equal `package.json` version and `ai_core.__version__`. It was left at
 * 0.3.0 across two releases, which is the exact failure this package exists to
 * prevent, in its own source: a version string that reports a state of the
 * world it is not in. Move all three in the same commit.
 */
export const CORE_VERSION = "0.7.0";

// ── Provenance: the trust contract ────────────────────────────────────────
export {
  ClaimRow,
  CommunityTray,
  CompanySaysVsStudentsReport,
  ContestedFact,
  SourceChip,
  StaleBadge,
  VerificationBadge,
} from "./components/Provenance";
export type {
  ClaimSource,
  RenderedClaim,
  Stance,
  VerificationState,
} from "./components/Provenance";

// ── Mastery: "not tested" is not zero ─────────────────────────────────────
export { MasteryBar, NotYetTested, STATE_LABEL, isDisplayable } from "./components/MasteryBar";
export type { MasteryState, MasteryValue } from "./components/MasteryBar";

// ── Missing-module alerts ─────────────────────────────────────────────────
export {
  DegradedSection,
  DependencyAlert,
  DependencyTable,
} from "./components/DependencyAlert";
export type { DegradedFeature, DependencyStatus } from "./components/DependencyAlert";

// ── The icon set ──────────────────────────────────────────────────────────
export { Icon, ICON_NAMES, IS_APPLE, MOD_KEY } from "./components/Icon";
export type { IconName } from "./components/Icon";

// ── Shared states ─────────────────────────────────────────────────────────
// `Layout`, `ModulePlaceholder` and `NavItem` are gone in 0.7.0. They were
// imported by nothing, and `Layout` asserted a shared frame that the one module
// with a UI had already replaced — see the docblock in Shell.tsx for the
// decision. A module owns its own chrome; this package owns the vocabulary.
export { Button, Card, EmptyState, ErrorNote, Spinner } from "./components/Shell";

// ── Utilities ─────────────────────────────────────────────────────────────
export { ApiError, api } from "./lib/api";
export { relativeDays, reportCount, shortDate } from "./lib/format";
export { LIVE_MODULES, MODULES, PLANNED_MODULES } from "./lib/modules";
export type { ModuleInfo } from "./lib/modules";
