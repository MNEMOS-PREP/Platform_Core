/**
 * The interviewer reads each line aloud, in the browser (2026-10-05) — the
 * interim output half of FR-6.10, as `speech.ts` is the input half.
 *
 * M11 owns voice. Until it exists, the browser's own speech synthesis speaks
 * each line of record in the voice the persona file names (`voice-core.ts`
 * chooses it), one sentence at a time. What M11 will do better, and this does
 * not try to: streaming the first clause before the line is finished, cutting
 * off within 350 ms when the student starts talking, and lip-sync from the
 * audio itself. This stops the moment the mic opens, which is the part of
 * barge-in a browser can do.
 *
 * New lines QUEUE behind the one being said — an acknowledgement and the next
 * question often arrive a moment apart, and the second must not cut the first
 * off mid-word. Only a repeat, a replay or a stop interrupts.
 *
 * The student can turn it off, and the choice is kept for this browser. A
 * screen-reader user hears the room's live region as well, so the off switch
 * is one press away rather than in a settings page.
 *
 * M11's, in core because more than one module speaks — see `core.ts`. The
 * `m06.voice` preference key is kept from when this lived in M06, so nobody's
 * off switch is lost in the move.
 *
 * ── The ledger (v0.15.0) ────────────────────────────────────────────────────
 * Every line spoken is also measured (`ledger.ts`): when it landed, when its
 * audio began, when it ended or was stopped and why, how much was heard. Pass
 * the room's `sessionId` and each finished line is posted to M11; the room
 * calls `mark("answer_sent")` and `mark("first_token")` so the next line
 * carries the two times only the room knows. Without a session id nothing is
 * posted and the hook behaves exactly as before.
 *
 * ── The server voice (v0.16.0) ──────────────────────────────────────────────
 * Where M11 is running, lines are spoken in the Chatterbox voice M11 casts for
 * the interviewer (`server.ts`), not the browser's. The room asks once whether
 * that voice is ready and keeps the answer for the interview — a voice never
 * changes mid-conversation, except to the browser's if a sentence fails, so a
 * failure costs realism and never sound. Sentences are asked for in speaking
 * order, each as soon as the one before it is made (v0.17.1): M11 makes one
 * at a time, so asking for all at once only let them race — a panel's
 * opening was heard to wait five seconds for its first sentence while M11
 * made the last one first. The first plays while the next is being made.
 *
 * ── A panel (v0.17.0) ───────────────────────────────────────────────────────
 * M06's panel says some lines in more than one voice: at a hand-over the
 * interviewer leaving names the one arriving, who then asks; at the start
 * everyone says hello. `speak` takes such a line as parts, each naming its
 * speaker, and every sentence is said in its own speaker's voice — M11's cast
 * voice for them, or the browser voice their `voice_id` picks. The ledger
 * still records the line as one line. `speakingPart` names the part being
 * heard, so the room can light the right face.
 *
 * ── Barge-in (v0.18.0) ──────────────────────────────────────────────────────
 * When the student starts speaking over the interviewer (`useListening`
 * hears it), `bargeIn` stops the line: the sentence playing, the sentences
 * queued behind it and the ones still being asked of M11 — a stop that only
 * silenced the speaker would have the interviewer resume mid-sentence (spec
 * Trap 3). The ledger records when the student began, so the stop is
 * measured from their first word. Final Boss may contest it (§6.5): the
 * interviewer keeps going for 1.5 s before yielding, once a round — the room
 * decides when.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import {
  parseVoiceId,
  pickVoice,
  rateFor,
  sentencesOf,
  type Sentence,
  type SpokenPart,
} from "./core";
import { forgetServerVoiceState, serverVoiceState, speakOnServer, type SpokenSentence } from "./server";
import {
  NO_MARKS,
  chunkOffsets,
  heardThrough,
  lineId,
  newLine,
  nowMs,
  timingsPath,
  type LineTiming,
  type RoomMarks,
  type StopReason,
} from "./ledger";

/** Best-effort and silent: the ledger measures the product, and a student's
 *  interview never waits on it or hears about it. M11 down drops the record. */
function postTiming(sessionId: string, line: LineTiming): void {
  void api.post(timingsPath(sessionId), line).catch(() => undefined);
}

const PREFERENCE_KEY = "m06.voice";

function readPreference(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writePreference(on: boolean) {
  try {
    localStorage.setItem(PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    /* still applies for this visit */
  }
}

const synth: SpeechSynthesis | null =
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

export const VOICE_SUPPORTED = synth !== null;

/** What the hook hands a room: speak, repeat, stop, the off switch, the mouth. */
export type InterviewerVoice = ReturnType<typeof useInterviewerVoice>;

export interface InterviewerVoiceOptions {
  /** The interview being spoken in. With it, each line is posted to M11's
   *  latency ledger; without it, nothing is. */
  sessionId?: string | null;
  /** Who is speaking (an M06 persona id): M11 speaks in the voice cast for
   *  them. Without it, M11 matches the `voiceId` instead. */
  personaId?: string | null;
  /** Use M11's voice when it is ready (the default), or only the browser's. */
  server?: boolean;
}

type Tier = "server" | "browser";

/** What `speak` takes: a line one interviewer says, or a panel's parts. */
export type SpokenLine = string | readonly SpokenPart[];

/** A sentence ready to say: who says it, and in the browser, with what. */
type Ready = Sentence & { voice: SpeechSynthesisVoice | null; lang: string; rate: number };

/** §6.5: a contested barge-in yields after this long. */
const CONTEST_MS = 1_500;

/** A line with no audio this long after it landed is recorded as unheard. */
const NO_AUDIO_AFTER_MS = 15_000;
/** A stopped line whose browser never reports the stop is closed anyway. */
const STOP_UNREPORTED_AFTER_MS = 1_000;

type OpenLine = LineTiming & { timer: number | null };

export function useInterviewerVoice(
  voiceId: string | null | undefined,
  options: InterviewerVoiceOptions = {},
) {
  const [enabled, setEnabledState] = useState(readPreference);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth?.getVoices() ?? []);
  /** Which line is being said — a turn id, or "idle" / "repeat". */
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  /** Which part of a panel's line is being heard — the room's part id. */
  const [speakingPart, setSpeakingPart] = useState<string | null>(null);
  /** The browser refused to speak before the student had clicked anything on
   *  this page (a reload mid-interview). One click says the line again. */
  const [blocked, setBlocked] = useState(false);
  const last = useRef<{ line: SpokenLine; key: string } | null>(null);
  /** Bumped by every interruption; a stale utterance's events are ignored. */
  const generation = useRef(0);
  /** Utterances queued and not yet finished, across lines. */
  const outstanding = useRef(0);
  // When the latest word began, and whether this voice reports words at all;
  // the face reads these every frame (see `mouth`), so no React state changes
  // per word.
  const activity = useRef({ wordAt: 0, reportsWords: false });
  /** Lines spoken and not yet recorded. */
  const open = useRef(new Set<OpenLine>());
  /** What the room has marked since the last line, for the next one. */
  const marks = useRef<RoomMarks>(NO_MARKS);
  const sessionId = useRef(options.sessionId ?? null);
  sessionId.current = options.sessionId ?? null;
  const who = useRef({ personaId: options.personaId ?? null, voiceId: voiceId ?? null });
  who.current = { personaId: options.personaId ?? null, voiceId: voiceId ?? null };
  const useServer = options.server !== false;
  /** Which voice this room speaks in — decided at its first line, then kept. */
  const tier = useRef<Tier | null>(null);
  const [tierShown, setTierShown] = useState<Tier | null>(null);
  const [serverVoiceName, setServerVoiceName] = useState<string | null>(null);
  /** The server line now playing, so a stop can pause it where it is. */
  const playing = useRef<{ audio: HTMLAudioElement; url: string; line: OpenLine; start: number; length: number } | null>(null);
  /** Requests for sentences not yet played, cancelled by a stop. */
  const requests = useRef(new Set<AbortController>());
  /** Server lines play one after another, never over each other. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** Sentences are asked of M11 one after another, in speaking order. */
  const asking = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, []);

  const spec = useMemo(() => parseVoiceId(voiceId), [voiceId]);
  const voice = useMemo(() => pickVoice(voices, spec), [voices, spec]);

  /** Record a line, once, and send it to the ledger if there is a session. */
  const close = useCallback((line: OpenLine) => {
    if (!open.current.delete(line)) return;
    if (line.timer !== null) window.clearTimeout(line.timer);
    const { timer: _timer, ...record } = line;
    if (sessionId.current) postTiming(sessionId.current, record);
  }, []);

  /** Stop speaking. The reason goes on every line it cuts short. */
  const stop = useCallback(
    (reason: StopReason = "end") => {
      const at = nowMs();
      const now = playing.current;
      playing.current = null;
      if (now) {
        // Heard as far as the audio got through its sentence.
        const fraction = now.audio.duration ? Math.min(1, now.audio.currentTime / now.audio.duration) : 0;
        now.line.heard_chars = now.start + Math.round(now.length * fraction);
        now.audio.pause();
        URL.revokeObjectURL(now.url);
      }
      for (const request of requests.current) request.abort();
      requests.current.clear();
      chain.current = Promise.resolve();
      asking.current = Promise.resolve();
      for (const line of [...open.current]) {
        if (line.stop_requested_at === null) {
          line.stop_requested_at = at;
          line.stop_reason = reason;
        }
        if (line.first_audio_at === null) {
          // Nothing of it was playing: stopped the moment it was asked.
          line.stopped_at = at;
          close(line);
        } else if (line.tier === "server") {
          // A paused <audio> is silent at once; there is no event to wait for.
          line.stopped_at = nowMs();
          close(line);
        } else if (line.timer === null) {
          line.timer = window.setTimeout(() => close(line), STOP_UNREPORTED_AFTER_MS);
        }
      }
      generation.current += 1;
      outstanding.current = 0;
      synth?.cancel();
      setSpeakingKey(null);
      setSpeakingPart(null);
    },
    [close],
  );

  /** A line in the browser's own voice, a sentence per utterance, each in
   *  the voice its speaker's `voice_id` picks. */
  const playInBrowser = useCallback(
    (line: OpenLine, chunks: Ready[], offsets: number[], gen: number, key: string) => {
      if (!synth) return;
      chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk.text);
        if (chunk.voice) utterance.voice = chunk.voice;
        utterance.lang = chunk.lang;
        utterance.rate = chunk.rate;
        const finished = () => {
          if (gen !== generation.current) return;
          outstanding.current = Math.max(0, outstanding.current - 1);
          if (outstanding.current === 0) {
            setSpeakingKey(null);
            setSpeakingPart(null);
          }
        };
        // The ledger's half of each event runs before the generation check:
        // a line cut short is still a line, and its stop is what is measured.
        const ended = () => {
          if (line.stop_requested_at !== null) {
            line.stopped_at ??= nowMs();
            close(line);
          } else if (index === chunks.length - 1) {
            line.ended_at = nowMs();
            line.heard_chars = line.line_chars;
            close(line);
          }
        };
        utterance.onstart = () => {
          if (line.first_audio_at === null && line.stop_requested_at === null) {
            line.first_audio_at = nowMs();
            if (line.timer !== null) window.clearTimeout(line.timer);
            line.timer = null;
          }
          if (gen !== generation.current) return;
          if (index === 0) activity.current = { wordAt: 0, reportsWords: false };
          setBlocked(false);
          setSpeakingKey(key);
          setSpeakingPart(chunk.partId);
        };
        utterance.onboundary = (event) => {
          if (event.name && event.name !== "word") return;
          if (line.stop_requested_at === null) {
            line.heard_chars = heardThrough(offsets[index] ?? 0, event.charIndex, event.charLength);
          }
          if (gen !== generation.current) return;
          activity.current = { wordAt: performance.now(), reportsWords: true };
        };
        utterance.onend = () => {
          ended();
          finished();
        };
        utterance.onerror = (event) => {
          if (event.error === "not-allowed") {
            line.blocked = true;
            close(line);
          } else if (event.error === "interrupted" || event.error === "canceled") {
            ended();
          } else {
            line.error = event.error;
            close(line);
          }
          if (gen !== generation.current) return;
          if (event.error === "not-allowed") setBlocked(true);
          finished();
        };
        outstanding.current += 1;
        synth.speak(utterance);
      });
    },
    [close],
  );

  /** One server sentence, played to its end (or until a stop pauses it). */
  const playClip = useCallback(
    (
      clip: SpokenSentence,
      line: OpenLine,
      start: number,
      length: number,
      last: boolean,
      gen: number,
      key: string,
      partId: string | null,
    ) =>
      new Promise<void>((resolve) => {
        const audio = new Audio(clip.url);
        playing.current = { audio, url: clip.url, line, start, length };
        const done = () => {
          if (playing.current?.audio === audio) {
            playing.current = null;
            URL.revokeObjectURL(clip.url);
          }
          resolve();
        };
        audio.onplaying = () => {
          if (line.first_audio_at === null && line.stop_requested_at === null) {
            line.first_audio_at = nowMs();
            if (line.timer !== null) window.clearTimeout(line.timer);
            line.timer = null;
          }
          if (gen !== generation.current) return;
          activity.current = { wordAt: 0, reportsWords: false };
          setBlocked(false);
          setSpeakingKey(key);
          setSpeakingPart(partId);
        };
        audio.onended = () => {
          line.heard_chars = start + length;
          if (last && line.stop_requested_at === null) {
            line.ended_at = nowMs();
            line.heard_chars = line.line_chars;
            close(line);
            if (gen === generation.current) {
              setSpeakingKey(null);
              setSpeakingPart(null);
            }
          }
          done();
        };
        audio.onerror = () => {
          line.error = "audio: could not play";
          close(line);
          done();
        };
        audio.play().catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            line.blocked = true;
            if (gen === generation.current) setBlocked(true);
          } else if (!(err instanceof DOMException && err.name === "AbortError")) {
            line.error = "audio: could not play";
          }
          close(line);
          done();
        });
      }),
    [close],
  );

  /** A line in M11's voice: every sentence asked for now, each in the voice
   *  cast for its speaker, played in order. */
  const playOnServer = useCallback(
    (line: OpenLine, chunks: Ready[], offsets: number[], gen: number, key: string) => {
      line.tier = "server";
      const request = new AbortController();
      requests.current.add(request);
      // In speaking order, each asked for when the one before it is made.
      const clips = chunks.map((chunk) => {
        const made = asking.current.then(() => {
          if (request.signal.aborted) throw new DOMException("stopped", "AbortError");
          return speakOnServer(chunk.text, { personaId: chunk.personaId, voiceId: chunk.voiceId }, request.signal);
        });
        asking.current = made.then(
          () => undefined,
          () => undefined,
        );
        return made;
      });
      for (const clip of clips) clip.catch(() => undefined);
      chain.current = chain.current.then(async () => {
        for (let i = 0; i < chunks.length; i++) {
          if (gen !== generation.current) return;
          let clip: SpokenSentence;
          try {
            clip = await clips[i]!;
          } catch (err) {
            if (gen !== generation.current) return; // a stop cancelled it
            // The server voice failed mid-line: the rest in the browser's
            // voice, and the browser's from now on in this room.
            line.error = `server: ${err instanceof Error ? err.message : "failed"}`.slice(0, 100);
            tier.current = "browser";
            setTierShown("browser");
            forgetServerVoiceState();
            line.tier = "browser";
            playInBrowser(line, chunks.slice(i), offsets.slice(i), gen, key);
            return;
          }
          if (gen !== generation.current) {
            URL.revokeObjectURL(clip.url);
            return;
          }
          if (i === 0) {
            line.voice_name = clip.voice;
            setServerVoiceName(clip.voice);
          }
          const chunk = chunks[i]!;
          await playClip(clip, line, offsets[i] ?? 0, chunk.text.length, i === chunks.length - 1, gen, key, chunk.partId);
        }
        requests.current.delete(request);
      });
    },
    [playClip, playInBrowser],
  );

  const enqueue = useCallback(
    (said: SpokenLine, key: string, landedAt: number, carried: RoomMarks) => {
      const gen = generation.current;
      const { line: spoken, sentences } = sentencesOf(said, who.current);
      if (sentences.length === 0) return;
      // The browser's voice for each speaker, chosen once per line.
      const picked = new Map<string, { voice: SpeechSynthesisVoice | null; lang: string; rate: number }>();
      const chunks: Ready[] = sentences.map((sentence) => {
        const id = sentence.voiceId ?? "";
        let choice = picked.get(id);
        if (!choice) {
          const wanted = parseVoiceId(sentence.voiceId);
          const found = pickVoice(voices, wanted);
          choice = { voice: found, lang: found?.lang ?? wanted.locale, rate: rateFor(wanted.manner) };
          picked.set(id, choice);
        }
        return { ...sentence, ...choice };
      });
      const offsets = chunkOffsets(
        spoken,
        chunks.map((chunk) => chunk.text),
      );
      const line: OpenLine = {
        ...newLine({
          id: lineId(),
          key,
          voiceName: chunks[0]!.voice?.name ?? null,
          rate: chunks[0]!.rate,
          lineChars: spoken.length,
          landedAt,
          marks: carried,
        }),
        timer: null,
      };
      open.current.add(line);
      line.timer = window.setTimeout(() => close(line), NO_AUDIO_AFTER_MS);
      const go = (t: Tier) =>
        t === "server" ? playOnServer(line, chunks, offsets, gen, key) : playInBrowser(line, chunks, offsets, gen, key);
      if (tier.current) {
        go(tier.current);
        return;
      }
      // The room's first line decides its voice, for the whole interview.
      const decided: Promise<Tier> = useServer
        ? serverVoiceState().then((state) => (state === "ready" ? "server" : "browser"))
        : Promise.resolve("browser");
      void decided.then((t) => {
        tier.current ??= t;
        setTierShown(tier.current);
        if (gen === generation.current) go(tier.current);
      });
    },
    [close, playInBrowser, playOnServer, useServer, voices],
  );

  /** Interrupt whatever is being said and say this instead. */
  const sayNow = useCallback(
    (said: SpokenLine, key: string, reason: StopReason) => {
      const landedAt = nowMs();
      stop(reason);
      const gen = generation.current;
      // Chrome drops an utterance queued in the same tick as a cancel.
      window.setTimeout(() => {
        if (gen === generation.current) enqueue(said, key, landedAt, NO_MARKS);
      }, 40);
    },
    [enqueue, stop],
  );

  /** Whether the interviewer can be heard right now — the listener raises
   *  its bar while they can (Trap 5). Cheap enough to read every frame. */
  const isSpeaking = useCallback(
    () => playing.current !== null || (synth?.speaking ?? false),
    [],
  );

  /**
   * The student began speaking over the interviewer at `startedAt` (spec
   * §6.5). Stops every line still to be heard — playing, queued, or being
   * made — and records when the student began. With `contest`, the
   * interviewer finishes up to 1.5 s more first. False when nothing was being
   * said, so the room knows it was a turn, not an interruption.
   */
  const bargeIn = useCallback(
    (startedAt: number, opts: { contest?: boolean } = {}) => {
      const unheard = [...open.current].filter((line) => line.stop_requested_at === null && line.ended_at === null);
      if (unheard.length === 0) return false;
      for (const line of unheard) {
        line.speech_started_at ??= startedAt;
        if (opts.contest) line.contested = true;
      }
      if (!opts.contest) {
        stop("barge_in");
        return true;
      }
      window.setTimeout(() => {
        // Yield — unless the line ended by itself meanwhile.
        if (unheard.some((line) => open.current.has(line) && line.ended_at === null)) stop("barge_in");
      }, CONTEST_MS);
      return true;
    },
    [stop],
  );

  /** A new line of the interview, said after anything still being said.
   *  Remembered even when the voice is off, so turning it on says it. It
   *  carries the room's marks: this is the line that answers them. */
  const speak = useCallback(
    (said: SpokenLine, key: string) => {
      last.current = { line: said, key };
      const carried = marks.current;
      marks.current = NO_MARKS;
      if (enabled) enqueue(said, key, nowMs(), carried);
    },
    [enabled, enqueue],
  );

  /** A line the student asked for again ("Repeat the question"). */
  const repeat = useCallback(
    (said: SpokenLine, key: string) => {
      last.current = { line: said, key };
      if (enabled) sayNow(said, key, "repeat");
    },
    [enabled, sayNow],
  );

  const replay = useCallback(() => {
    if (last.current) sayNow(last.current.line, last.current.key, "repeat");
  }, [sayNow]);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      writePreference(on);
      if (!on) stop("off");
      // Turned on mid-question: say the question, which is what it is for.
      else if (last.current) sayNow(last.current.line, last.current.key, "off");
    },
    [sayNow, stop],
  );

  /**
   * What only the room knows, for the next line it speaks: the student's
   * answer was sent (the spec's end of speech, while recognition is the
   * browser's), and the interviewer's first token streamed back.
   */
  const mark = useCallback((what: "answer_sent" | "first_token") => {
    const at = nowMs();
    if (what === "answer_sent") marks.current = { answer_sent_at: at, first_token_at: null };
    else if (marks.current.answer_sent_at !== null && marks.current.first_token_at === null) {
      marks.current = { ...marks.current, first_token_at: at };
    }
  }, []);

  // Leaving the room silences it — a tick later, and only if the room is
  // really gone. React's StrictMode runs this cleanup between its two mounts
  // in development, and cancelling at once dropped the opening question the
  // millisecond it was queued: on a first start the student heard nothing
  // until their first answer (found 2026-10-05, a speak/cancel trace).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.setTimeout(() => {
        if (mounted.current) return;
        playing.current?.audio.pause();
        for (const request of requests.current) request.abort();
        const at = nowMs();
        for (const line of [...open.current]) {
          line.stop_requested_at ??= at;
          line.stop_reason ??= "leave";
          line.stopped_at ??= at;
          close(line);
        }
        synth?.cancel();
      }, 0);
    };
  }, [close]);

  /**
   * How open the mouth is, 0 to 1, for this frame. Opens on each word and
   * closes over ~220 ms; a voice that reports no word boundaries gets a
   * gentle loop instead, so the face still talks while it speaks.
   */
  const mouth = useCallback((now: number) => {
    const { wordAt, reportsWords } = activity.current;
    if (reportsWords) {
      const flutter = 0.65 + 0.35 * Math.abs(Math.sin(now / 85));
      return Math.max(0, 1 - (now - wordAt) / 220) * flutter;
    }
    return 0.25 + 0.4 * Math.abs(Math.sin(now / 120));
  }, []);

  return {
    supported: VOICE_SUPPORTED,
    enabled,
    setEnabled,
    speakingKey,
    /** The part of a panel's line being heard (the id the room gave it). */
    speakingPart,
    blocked,
    speak,
    repeat,
    stop,
    replay,
    mark,
    mouth,
    /** The student began speaking over the interviewer (v0.18.0). */
    bargeIn,
    /** Whether the interviewer can be heard right now. */
    isSpeaking,
    /** The voice speaking: M11's cast voice key, or the browser voice's name. */
    voiceName: tierShown === "server" ? serverVoiceName : (voice?.name ?? null),
    /** Which voice this room speaks in, once its first line has decided it. */
    tier: tierShown,
  };
}
