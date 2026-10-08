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
export { ApiError, api, isOffline, setIdentityHeaders } from "./lib/api";

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
export { VOICE_SUPPORTED, prepareLine, useInterviewerVoice } from "./voice/useInterviewerVoice";
export type { BargeInCut, InterviewerVoice, InterviewerVoiceOptions, SpokenLine } from "./voice/useInterviewerVoice";
// A panel's line (v0.17.0): parts, each said in its own speaker's voice.
export { cutAt, partRanges, sentencesOf } from "./voice/core";
export type { PartRange, Sentence, SpokenPart } from "./voice/core";
// Hearing the student start to speak (v0.18.0): the mic, and the barge-in rule.
export { useListening } from "./voice/useListening";
export type { Listening, ListeningOptions } from "./voice/useListening";
export { DEFAULT_VAD, dbOf, initialVad, stepVad } from "./voice/vad";
export type { VadConfig, VadEvent, VadState } from "./voice/vad";
// The student's words, heard by M11 (v0.19.0): word timestamps from a WAV.
export { serverAsrAvailable, transcribeOnServer } from "./voice/asr";
export type { AsrResult, AsrWord } from "./voice/asr";
export { ASR_RATE, encodeWav } from "./voice/wav";
// A spoken turn, start to finish (v0.20.0): the speaker's own pauses, then
// M11's turn model, then one transcription for the whole turn.
export { useTurnTaking } from "./voice/useTurnTaking";
export type { SpokenTurn, TurnTaking, TurnTakingOptions } from "./voice/useTurnTaking";
export { DEFAULT_ENDPOINT, adaptiveSilenceMs, decide, initialEndpoint, modelSaid, speechEnded, speechStarted, turnTaken } from "./voice/endpoint";
export type { Decision, EndpointConfig, EndpointState } from "./voice/endpoint";
export { serverTurnReady, turnFinishedOnServer } from "./voice/turn";
// The microphone check and echo (v0.22.0): the room's floor, kept; a
// transcription round trip; the interviewer's words coming back.
export {
  firstWordLost,
  heardBack,
  isEcho,
  looksLikeBluetooth,
  overlap,
  roomFrom,
  savedNoiseFloor,
  saveNoiseFloor,
} from "./voice/micCheck";
// Live captions from M11's recogniser (v0.25.0, FR-11.3).
export { CAPTION_EVERY_MS, CAPTION_WINDOW_MS, captionFrom, useRollingCaption } from "./voice/caption";
export type { Caption, CaptionWord } from "./voice/caption";
export type { Room } from "./voice/micCheck";
// Day 11-12 (v0.23.0): when the interviewer answers, a clause-sized first
// chunk, and the student's answers kept with consent.
export { deliberateMs, naturalGapMs, silenceBeforeMs } from "./voice/silence";
export type { SilenceInput } from "./voice/silence";
export { clauses, firstClause } from "./voice/core";
export {
  forgetKeptAnswers,
  keepAnswerAudio,
  keepingAnswers,
  keptAnswers,
  keptAnswerUrl,
  setKeepingAnswers,
} from "./voice/kept";
export type { KeptAnswer } from "./voice/kept";
export type { TurnVerdict } from "./voice/turn";
// The latency ledger's browser half (v0.15.0): one record per spoken line.
export { chunkOffsets, heardThrough, timingsPath } from "./voice/ledger";
// M11's server voice (v0.16.0): is it ready, and one sentence in a cast voice.
export {
  dropOnServer,
  faceOnServer,
  forgetServerVoiceState,
  planOnServer,
  serverVoiceState,
  speakOnServer,
} from "./voice/server";
// v0.27.0: the interviewer's face, lip-synced to the voice's own audio.
export { FACE_LOOKAHEAD_S, jawOnly, weightsAt } from "./voice/face";
export type { Expression, FaceFrames } from "./voice/face";
export { useInterviewerFaces } from "./voice/useInterviewerFaces";
export { TalkingHead } from "./components/TalkingHead";
export type { TalkingHeadProps } from "./components/TalkingHead";
export type { PlannedSentence, ServerVoiceState, SpokenSentence } from "./voice/server";
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
