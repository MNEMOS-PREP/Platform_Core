/**
 * The microphone, listening for the student to start speaking — M11 day 3.
 *
 * Opens the mic with the browser's echo cancellation, noise suppression and
 * gain control on (spec §5's `AudioConfig`; Trap 5), cuts what it hears into
 * 20 ms frames on the audio thread, and runs `vad.ts` over them. The room is
 * told when speech starts — dated from its first loud frame — and when it
 * ends. With `keepAudio` off, nothing is kept: the frames are levels, read
 * and dropped.
 *
 * Day 4 (`keepAudio`): the same audio thread also keeps the last few minutes
 * at 16 kHz, so the room can cut out exactly what the student just said —
 * from a moment BEFORE the detector decided it was speech, where the first
 * word is — as a WAV for M11's recogniser (`audioBetween`). It stays in this
 * page's memory, and is gone when listening stops.
 *
 * Off unless the room turns it on. A mic that is always listening is the
 * student's choice to make, and the browser shows that it is on.
 */
import { useEffect, useRef, useState } from "react";

import { nowMs } from "./ledger";
import { DEFAULT_VAD, initialVad, stepVad, type VadConfig, type VadState } from "./vad";
import { ASR_RATE, encodeWav, joinSamples } from "./wav";

export interface ListeningOptions {
  /** Listen now. Turning it off releases the microphone. */
  enabled: boolean;
  /** Whether the interviewer is speaking at this moment — the bar rises
   *  while they do. Read per frame, so it can be a ref-backed function. */
  playing?: () => boolean;
  /** Speech began at `startedAt` (its first loud frame) and was recognised as
   *  speech at `decidedAt`, both on the ledger's clock. */
  onSpeechStart?: (startedAt: number, decidedAt: number) => void;
  onSpeechEnd?: (at: number) => void;
  config?: Partial<VadConfig>;
  /** Keep the last few minutes of audio, for `audioBetween` (day 4). */
  keepAudio?: boolean;
}

export interface Listening {
  /** The microphone is open and frames are arriving. */
  active: boolean;
  /** The student is speaking, as far as the detector can tell. */
  speaking: boolean;
  /** Why the microphone could not be opened, in words for the student. */
  error: string | null;
  /** How loud, 0–1 over the room's floor, for a meter. Read per frame. */
  level: () => number;
  /** What the mic heard between two times on the ledger's clock, as a 16 kHz
   *  WAV — or null when no audio is kept (`keepAudio` off, or a browser
   *  without an audio thread). */
  audioBetween: (from: number, to: number) => Blob | null;
}

/** How much audio is kept: an answer longer than this is cut to its end. */
const KEEP_MS = 4 * 60_000;

/** Runs on the audio thread: 20 ms frames, as levels in dBFS — and, when
 *  asked, the frame's audio at 16 kHz (each output sample the mean of the
 *  input samples it covers: a crude low-pass, enough for a recogniser). */
const WORKLET = `
class Levels extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = Math.round(sampleRate * 0.02);
    this.sum = 0;
    this.n = 0;
    this.keep = Boolean(options && options.processorOptions && options.processorOptions.keep);
    this.ratio = sampleRate / ${ASR_RATE};
    this.acc = 0;
    this.accN = 0;
    this.pos = 0;
    this.next = this.ratio;
    this.out = [];
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const x = channel[i];
        this.sum += x * x;
        this.n += 1;
        if (this.keep) {
          this.acc += x;
          this.accN += 1;
          this.pos += 1;
          if (this.pos >= this.next) {
            this.out.push(this.acc / this.accN);
            this.acc = 0;
            this.accN = 0;
            this.next += this.ratio;
          }
        }
        if (this.n >= this.size) {
          const rms = Math.sqrt(this.sum / this.n);
          const db = Math.max(-100, 20 * Math.log10(Math.max(rms, 1e-10)));
          if (this.keep) {
            const pcm = new Int16Array(this.out.length);
            for (let j = 0; j < this.out.length; j++) {
              pcm[j] = Math.max(-32768, Math.min(32767, Math.round(this.out[j] * 32767)));
            }
            this.out = [];
            this.port.postMessage({ db, pcm }, [pcm.buffer]);
          } else {
            this.port.postMessage({ db });
          }
          this.sum = 0;
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("m11-levels", Levels);
`;

function explain(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "The microphone is blocked for this site — allow it in the address bar to talk freely.";
  if (name === "NotFoundError") return "No microphone was found.";
  if (name === "NotReadableError") return "Another app is using the microphone.";
  return "The microphone could not be opened.";
}

export function useListening(options: ListeningOptions): Listening {
  const [active, setActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const levelNow = useRef(0);
  /** Kept audio, frame by frame, each with when it was heard. */
  const kept = useRef<{ at: number; pcm: Int16Array }[]>([]);

  useEffect(() => {
    if (!options.enabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot listen.");
      return;
    }
    let stopped = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let timer: number | null = null;
    let url: string | null = null;
    let vad: VadState = initialVad();
    const config: VadConfig = { ...DEFAULT_VAD, ...latest.current.config };

    const frame = (db: number, pcm?: Int16Array) => {
      if (stopped) return;
      if (pcm) {
        const at = nowMs();
        const frames = kept.current;
        frames.push({ at, pcm });
        while (frames.length > 0 && at - frames[0]!.at > KEEP_MS) frames.shift();
      }
      const playing = latest.current.playing?.() ?? false;
      const out = stepVad(vad, { db, at: nowMs(), playing }, config);
      vad = out.state;
      // 0 at the floor, 1 at 40 dB above it.
      levelNow.current = Math.max(0, Math.min(1, (db - vad.floorDb) / 40));
      if (out.event?.kind === "start") {
        setSpeaking(true);
        latest.current.onSpeechStart?.(out.event.at, out.event.decidedAt);
      } else if (out.event?.kind === "end") {
        setSpeaking(false);
        latest.current.onSpeechEnd?.(out.event.at);
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
        if (stopped) return;
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        if (context.audioWorklet) {
          url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
          await context.audioWorklet.addModule(url);
          if (stopped) return;
          const node = new AudioWorkletNode(context, "m11-levels", {
            processorOptions: { keep: Boolean(latest.current.keepAudio) },
          });
          node.port.onmessage = (event: MessageEvent<{ db: number; pcm?: Int16Array }>) =>
            frame(event.data.db, event.data.pcm);
          source.connect(node);
        } else {
          // No worklet: an analyser read every 20 ms on the page's own clock.
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          timer = window.setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const x of samples) sum += x * x;
            frame(Math.max(-100, 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-10))));
          }, 20);
        }
        setError(null);
        setActive(true);
      } catch (err) {
        if (!stopped) setError(explain(err));
      }
    })();

    return () => {
      stopped = true;
      if (timer !== null) window.clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
      void context?.close().catch(() => undefined);
      if (url) URL.revokeObjectURL(url);
      levelNow.current = 0;
      kept.current = [];
      setActive(false);
      setSpeaking(false);
    };
  }, [options.enabled]);

  const audioBetween = (from: number, to: number): Blob | null => {
    // A frame is stamped when it ARRIVED, ~20 ms after it began.
    const frames = kept.current.filter((f) => f.at >= from && f.at - 20 <= to);
    if (frames.length === 0) return null;
    const wav = encodeWav(joinSamples(frames.map((f) => f.pcm)));
    return new Blob([wav], { type: "audio/wav" });
  };

  return { active, speaking, error, level: () => levelNow.current, audioBetween };
}

