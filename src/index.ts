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

export const CORE_VERSION = "0.1.0";

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

// ── Missing-module alerts ─────────────────────────────────────────────────
export {
  DegradedSection,
  DependencyAlert,
  DependencyTable,
} from "./components/DependencyAlert";
export type { DegradedFeature, DependencyStatus } from "./components/DependencyAlert";

// ── App chrome and states ─────────────────────────────────────────────────
export { Card, ErrorNote, Layout, ModulePlaceholder, Spinner } from "./components/Shell";

// ── Utilities ─────────────────────────────────────────────────────────────
export { ApiError, api } from "./lib/api";
export { relativeDays, reportCount, shortDate } from "./lib/format";
export { LIVE_MODULES, MODULES, PLANNED_MODULES } from "./lib/modules";
export type { ModuleInfo } from "./lib/modules";
