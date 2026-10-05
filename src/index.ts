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
export const CORE_VERSION = "0.16.0";

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

// ── One page header, and loading with a shape (v0.13.0) ──────────────────
export {
  HowItWorks,
  PageHeader,
  Skeleton,
  SkeletonCards,
  SkeletonRows,
} from "./components/Page";

// ── Utilities ─────────────────────────────────────────────────────────────
export { ApiError, api, setIdentityHeaders } from "./lib/api";

// ── The session: who is signed in, once per page (v0.12.0) ───────────────
export {
  ROLES,
  ROLE_LABEL,
  SEEDED_CANDIDATE_ID,
  STAFF_ROLES,
  candidateIdOf,
  ensureSession,
  getSession,
  isStaff,
  sessionHeaders,
  signIn,
  signOut,
  subscribeSession,
  useSession,
} from "./lib/session";
export type { Role, Session } from "./lib/session";
export {
  ANSWER_BAND_LABEL,
  answerBand,
  relativeDays,
  reportCount,
  shortDate,
} from "./lib/format";
export type { AnswerBand } from "./lib/format";
export { LIVE_MODULES, MODULES, PLANNED_MODULES } from "./lib/modules";
export type { ModuleInfo } from "./lib/modules";

// ── The interviewer's voice (v0.14.0) ─────────────────────────────────────
// M11's (Voice_Engine), here because more than one module speaks: M06's
// interview room and M11's voice check today, M14's discussion room next.
export { VOICE_SUPPORTED, useInterviewerVoice } from "./voice/useInterviewerVoice";
export type { InterviewerVoice, InterviewerVoiceOptions, SpokenLine } from "./voice/useInterviewerVoice";
// A panel's line (v0.17.0): parts, each said in its own speaker's voice.
export { sentencesOf } from "./voice/core";
export type { Sentence, SpokenPart } from "./voice/core";
// The latency ledger's browser half (v0.15.0): one record per spoken line.
export { chunkOffsets, heardThrough, timingsPath } from "./voice/ledger";
// M11's server voice (v0.16.0): is it ready, and one sentence in a cast voice.
export { forgetServerVoiceState, serverVoiceState, speakOnServer } from "./voice/server";
export type { ServerVoiceState, SpokenSentence } from "./voice/server";
export type { LineTiming, RoomMarks, StopReason } from "./voice/ledger";
export {
  kindOf,
  parseVoiceId,
  pickVoice,
  rateFor,
  score as voiceScore,
  speakable,
  splitSentences,
} from "./voice/core";
export type { VoiceLike, VoiceSpec } from "./voice/core";
