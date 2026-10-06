/**
 * The interviewer's voice, worked out from what the browser has (2026-10-05).
 *
 * Pure functions — no React, no `window` — so `npm test` runs them in Node.
 * `useInterviewerVoice.ts` is the hook that uses them.
 *
 * ── Whose this is ───────────────────────────────────────────────────────────
 * M11's (Voice_Engine), which owns voice; it lives in core because more than
 * one module speaks. It was written in M06 on 2026-10-05 as M11's interim and
 * moved here (v0.14.0) when M11 started: M06's interview room and M11's own
 * voice check both use it, and M14's discussion room will. Copies would drift,
 * and a module frontend importing another's would stop running alone.
 *
 * ── Why the browser, and why it is enough for now ───────────────────────────
 * M11 (the voice engine) is not built. Every browser ships speech synthesis,
 * and Microsoft Edge's includes neural Indian-English voices ("Microsoft
 * Neerja / Prabhat Online (Natural) - English (India)") at no cost and with
 * nothing installed. Chrome on Windows has Windows' own Indian-English voices
 * (Heera, Ravi), and Safari on a Mac has Veena and Rishi. So each persona's
 * authored `voice_id` (`en-IN-female-warm`) can be honoured today, and M11
 * maps the same id to its own voices later.
 */

export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
}

/** A persona's `voice_id`, read: `locale-kind-manner`. */
export interface VoiceSpec {
  locale: string;
  /** The persona file's word ("female", "male") — authored, never inferred. */
  kind: string;
  /** "warm", "neutral", "brisk", "measured", "casual". */
  manner: string;
}

const DEFAULT_SPEC: VoiceSpec = { locale: "en-IN", kind: "", manner: "neutral" };

export function parseVoiceId(id: string | null | undefined): VoiceSpec {
  const match = /^([a-z]{2})-([A-Z]{2})-([a-z]+)-([a-z]+)$/.exec(id ?? "");
  if (!match) return DEFAULT_SPEC;
  return { locale: `${match[1]}-${match[2]}`, kind: match[3]!, manner: match[4]! };
}

/**
 * Voice names browsers ship whose kind is known.
 *
 * The Web Speech API does not say whether a voice is a woman's or a man's, so
 * this is the one table in the module — the fallback the no-hardcoding rule
 * allows when nothing can be derived. A voice not in it is still used, chosen
 * by locale and quality; it is only not matched on kind. Names a browser puts
 * in the voice itself ("Google UK English Female") are read from the name.
 */
const KNOWN_KIND: Record<string, "female" | "male"> = {
  // Indian English — Edge online, Windows, Azure names Edge sometimes lists, macOS
  neerja: "female", prabhat: "male", heera: "female", ravi: "male",
  aashi: "female", ananya: "female", kavya: "female", aarav: "male", kunal: "male", rehaan: "male",
  veena: "female", rishi: "male",
  // US English — Windows and Edge online
  zira: "female", david: "male", mark: "male", aria: "female", jenny: "female", guy: "male",
  ana: "female", michelle: "female", emma: "female", ava: "female",
  christopher: "male", eric: "male", roger: "male", steffan: "male", andrew: "male", brian: "male",
  // UK English — Windows and Edge online
  hazel: "female", susan: "female", george: "male", libby: "female", maisie: "female", sonia: "female",
  ryan: "male", thomas: "male",
  // macOS
  samantha: "female", karen: "female", moira: "female", tessa: "female", daniel: "male", alex: "male",
};

export function kindOf(voice: VoiceLike): "female" | "male" | null {
  if (/\bfemale\b/i.test(voice.name)) return "female";
  if (/\bmale\b/i.test(voice.name)) return "male";
  for (const word of voice.name.toLowerCase().split(/[^a-z]+/)) {
    const known = KNOWN_KIND[word];
    if (known) return known;
  }
  return null;
}

/**
 * How well a voice fits a persona. An exact locale beats the same language;
 * a neural voice beats a robotic one; the persona's kind matters more than
 * its accent — Priya in a British woman's voice reads as Priya, in an Indian
 * man's voice she does not. Another language entirely is not a candidate.
 */
export function score(voice: VoiceLike, spec: VoiceSpec): number {
  const lang = voice.lang.replace("_", "-").toLowerCase();
  const want = spec.locale.toLowerCase();
  let points: number;
  if (lang === want) points = 100;
  else if (lang.slice(0, 2) === want.slice(0, 2)) points = 40;
  else return Number.NEGATIVE_INFINITY;
  if (/\b(natural|neural)\b/i.test(voice.name)) points += 30;
  else if (/\b(online|google)\b/i.test(voice.name) || !voice.localService) points += 15;
  const kind = kindOf(voice);
  if (kind && spec.kind) points += kind === spec.kind ? 40 : -40;
  return points;
}

/** The best voice for a persona, or null when the browser has no voice in
 *  its language. Ties go by name, so the choice is the same on every load. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], spec: VoiceSpec): V | null {
  let best: V | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const voice of voices) {
    const s = score(voice, spec);
    if (s > bestScore || (s === bestScore && best && voice.name < best.name)) {
      best = voice;
      bestScore = s;
    }
  }
  return bestScore === Number.NEGATIVE_INFINITY ? null : best;
}

/** The persona's manner as a speaking rate. Pitch is left alone: neural
 *  voices bend badly, and pace is what an interviewer's manner sounds like. */
const RATE: Record<string, number> = { warm: 0.97, neutral: 1, brisk: 1.1, measured: 0.92, casual: 1.04 };

export function rateFor(manner: string): number {
  return RATE[manner] ?? 1;
}

/** Things a voice would read wrongly, said the way an interviewer says them.
 *  M11's lexicon (EC-11.11) will own this; these are the ones that come up. */
const SAY: [RegExp, string][] = [
  [/\bC\+\+/g, "C plus plus"],
  [/\bC#/g, "C sharp"],
  [/\.NET\b/g, "dot net"],
  [/\be\.g\./gi, "for example"],
  [/\bi\.e\./gi, "that is"],
  [/\betc\./gi, "etcetera"],
  [/\bvs\.?(?=\s)/gi, "versus"],
  // Titles, as they are said: a panel names "Dr. Raghavan" at every hand-over.
  [/\bDr\.(?=\s)/g, "Doctor"],
  [/\bProf\.(?=\s)/g, "Professor"],
  [/&/g, " and "],
];

/** Words ending in a full stop that do not end a sentence. */
const NOT_AN_END = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|No)\.$/;

/** A line as it should be heard: code and links are on screen, not read out. */
export function speakable(text: string): string {
  let out = text
    .replace(/```[\s\S]*?(```|$)/g, " The code is on your screen. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/g, " the link on your screen ")
    // Big-O as it is said: O(n log n) → "O of n log n", O(n^2) → "O of n squared".
    .replace(/\bO\(([^()]{1,24})\)/g, (_, inner: string) =>
      `O of ${inner.replace(/\^\s*2\b/g, " squared").replace(/\^\s*3\b/g, " cubed")}`,
    )
    .replace(/\n\s*[-•*]\s+/g, ". ");
  for (const [pattern, said] of SAY) out = out.replace(pattern, said);
  return out
    .replace(/[*_#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sentences, each short enough to speak whole. Chrome stops a long utterance
 * partway with no error, and one sentence at a time also lets the student cut
 * in between them rather than after a paragraph.
 */
export function splitSentences(text: string, max = 220): string[] {
  // "Dr. Raghavan, over to you." is one sentence: a title's full stop is
  // not an end, and splitting there made a voice say "Dr." alone and pause.
  const pieces: string[] = [];
  for (const piece of text.split(/(?<=[.?!])\s+/)) {
    const previous = pieces.at(-1);
    if (previous !== undefined && NOT_AN_END.test(previous)) pieces[pieces.length - 1] = `${previous} ${piece}`;
    else pieces.push(piece);
  }
  const out: string[] = [];
  for (const sentence of pieces) {
    let rest = sentence.trim();
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max));
      const at = cut > max / 3 ? cut + 1 : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

// ── A panel's line (v0.17.0) ───────────────────────────────────────────────
// M06's panel (FR-6.3) says some lines in more than one voice: at a hand-over
// the interviewer leaving names the one arriving, who then asks; at the start
// everyone says hello. Each part is said in its own speaker's voice.

/** One person's words within a line. */
export interface SpokenPart {
  text: string;
  /** Who says it (an M06 persona id): M11 speaks in the voice cast for them. */
  personaId?: string | null;
  /** Their `locale-kind-manner` voice id: the browser's voice is chosen by it. */
  voiceId?: string | null;
  /** The room's name for this part, reported back while it is being heard. */
  id?: string | null;
  /** Silence after this part, ms — a note-taking pause (FR-11.12). */
  pauseAfterMs?: number;
}

/** Where one part of a line sits in the line as spoken, in characters. */
export interface PartRange {
  id: string | null;
  start: number;
  end: number;
}

/** The parts' ranges, from the line's sentences and where each begins. */
export function partRanges(sentences: readonly { text: string; partId: string | null }[], offsets: readonly number[]): PartRange[] {
  const ranges: PartRange[] = [];
  sentences.forEach((sentence, i) => {
    const start = offsets[i] ?? 0;
    const end = start + sentence.text.length;
    const last = ranges[ranges.length - 1];
    if (last && last.id === sentence.partId) last.end = end;
    else ranges.push({ id: sentence.partId, start, end });
  });
  return ranges;
}

/** Where the student came in (FR-11.9): the part being heard and how far
 *  through it, 0–1, from how many characters of the line were heard. */
export function cutAt(ranges: readonly PartRange[], heardChars: number): { partId: string | null; heard: number } {
  if (ranges.length === 0) return { partId: null, heard: 0 };
  const part = ranges.find((r) => heardChars < r.end) ?? ranges[ranges.length - 1]!;
  const span = Math.max(1, part.end - part.start);
  return { partId: part.id, heard: Math.max(0, Math.min(1, (heardChars - part.start) / span)) };
}

/** One sentence of a line, and who says it. */
export interface Sentence {
  text: string;
  partId: string | null;
  personaId: string | null;
  voiceId: string | null;
  /** Silence after this sentence, ms: its part's pause, on its last sentence. */
  pauseAfterMs: number;
}

/** FR-11.7: a long first sentence is cut at its first clause, so the first
 *  audio is made from a few words, not a paragraph — the voice is made at
 *  ~2x real time on a CPU, so a short first chunk is heard seconds sooner,
 *  and a comma is where a speaker breathes anyway. */
export function firstClause(sentence: string, minWords = 4, longWords = 12): string[] {
  const count = (text: string) => text.split(/\s+/).filter(Boolean).length;
  if (count(sentence) <= longWords) return [sentence];
  // The first clause boundary that leaves a real clause on both sides:
  // "Thanks," alone is not one.
  for (const match of sentence.matchAll(/[,;:—–] /g)) {
    const at = (match.index ?? 0) + 1;
    const head = sentence.slice(0, at).trim();
    const tail = sentence.slice(at).trim();
    if (count(head) >= minWords && count(tail) >= minWords) return [head, tail];
  }
  return [sentence];
}

/**
 * A line as it is spoken: the text heard (every part, in order, speakable)
 * and its sentences, each carrying its speaker. A part that names nobody is
 * said by the room's own interviewer (`defaults`); a part with nothing to say
 * is skipped.
 */
export function sentencesOf(
  parts: string | readonly SpokenPart[],
  defaults: { personaId: string | null; voiceId: string | null },
): { line: string; sentences: Sentence[] } {
  const list: readonly SpokenPart[] = typeof parts === "string" ? [{ text: parts }] : parts;
  const said: string[] = [];
  const sentences: Sentence[] = [];
  for (const part of list) {
    const spoken = speakable(part.text);
    if (!spoken) continue;
    said.push(spoken);
    const pieces = splitSentences(spoken);
    // Only the line's very first sentence is cut at a clause: after that,
    // the next sentence is made while this one plays.
    const chunks = sentences.length === 0 && pieces.length > 0
      ? [...firstClause(pieces[0]!), ...pieces.slice(1)]
      : pieces;
    chunks.forEach((text, i) => {
      sentences.push({
        text,
        partId: part.id ?? null,
        personaId: part.personaId ?? defaults.personaId,
        voiceId: part.voiceId ?? defaults.voiceId,
        pauseAfterMs: i === chunks.length - 1 ? Math.max(0, part.pauseAfterMs ?? 0) : 0,
      });
    });
  }
  return { line: said.join(" "), sentences };
}
