/**
 * The interviewer's voice as one track (v0.29.0, 2026-10-09) — Web Audio.
 *
 * Each sentence used to be its own `<audio>`, started when the one before it
 * ended: a decode and a start at every join, on top of the silence each clip
 * carries. Here every clip is decoded as it arrives, trimmed to its sound
 * (`track.ts`'s `trimBounds`), and scheduled on one clock to begin exactly
 * when the one before it ends plus the pause a person would leave there — so
 * a line, and the line after it, play as one continuous voice.
 *
 * The clock that matters is what the speakers are sounding right now
 * (`heardTime`: the context's output timestamp, which counts the output
 * device's delay), so the face's lip sync reads it — never the page's clock.
 * A stop fades the sound out over a few milliseconds rather than clicking.
 *
 * Browser-only; `track.ts` holds what can be tested without one.
 */
import type { Bounds } from "./track";

/** A clip on the track. Times are the context's, in seconds. */
export interface Scheduled<Meta = unknown> {
  /** When its (trimmed) sound starts. */
  startAt: number;
  /** When it ends. */
  endAt: number;
  /** Where in the original clip the trimmed sound begins: its lip sync is
   *  timed from the clip's own start. */
  offset: number;
  /** Seconds of sound. */
  duration: number;
  /** The hook's own record for it. */
  meta: Meta;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** Ended or stopped. */
  over: boolean;
}

type AudioContextClass = typeof AudioContext;

function contextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const found = (window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext) as
    | AudioContextClass
    | undefined;
  return found ?? null;
}

export const PLAYER_SUPPORTED = contextClass() !== null;

/** Scheduling this far ahead of the clock never misses a start. */
const SAFETY_S = 0.03;
/** A stop fades out this fast: quick, but no click. */
const FADE_S = 0.025;

export class SpeechPlayer<Meta = unknown> {
  private ctx: AudioContext | null = null;
  private clips: Scheduled<Meta>[] = [];

  /** The context, made on first use (one per page). */
  context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Class = contextClass();
    if (!Class) return null;
    this.ctx = new Class({ latencyHint: "interactive" });
    return this.ctx;
  }

  /**
   * Whether sound can play now. A page that has not been clicked yet may not
   * start audio (autoplay policy): the context stays suspended, and the room
   * shows its "click to hear" — the click resumes it.
   */
  async running(waitMs = 400): Promise<boolean> {
    const ctx = this.context();
    if (!ctx) return false;
    if (ctx.state === "running") return true;
    const resumed = ctx.resume().then(
      () => true,
      () => false,
    );
    const late = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), waitMs));
    // Read afresh: `resume` changed it since the check above.
    return (await Promise.race([resumed, late])) && (ctx.state as AudioContextState) === "running";
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.context();
    if (!ctx) throw new Error("no Web Audio");
    return ctx.decodeAudioData(data);
  }

  /** The context's time of the sound at the speakers now. */
  heardTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const stamp = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
    if (stamp && stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0) {
      return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /** When the last clip on the track ends (context time); 0 when empty. */
  tail(): number {
    const live = this.clips.filter((clip) => !clip.over);
    return live.length ? Math.max(...live.map((clip) => clip.endAt)) : 0;
  }

  /** Whether anything is playing or about to (a pause inside a line too). */
  busy(): boolean {
    return this.ctx !== null && this.tail() > this.ctx.currentTime;
  }

  /**
   * Put a clip on the track: `gap` seconds after the last clip ends, or — the
   * track empty, or that moment past — as soon as it can start, but never
   * before `earliest` (context time; the room's calibrated gap, a held first
   * word).
   */
  schedule(
    buffer: AudioBuffer,
    bounds: Bounds,
    gap: number,
    meta: Meta,
    { earliest = 0, volume = 1, onEnded }: { earliest?: number; volume?: number; onEnded?: () => void } = {},
  ): Scheduled<Meta> {
    const ctx = this.context();
    if (!ctx) throw new Error("no Web Audio");
    const after = this.tail();
    const soonest = ctx.currentTime + SAFETY_S;
    const startAt = Math.max(soonest, earliest, after > 0 ? after + gap : 0);
    const duration = Math.max(0.01, bounds.end - bounds.start);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start(startAt, bounds.start, duration);
    const clip: Scheduled<Meta> = {
      startAt,
      endAt: startAt + duration,
      offset: bounds.start,
      duration,
      meta,
      source,
      gain,
      over: false,
    };
    source.onended = () => {
      clip.over = true;
      this.clips = this.clips.filter((other) => other !== clip);
      onEnded?.();
    };
    this.clips.push(clip);
    return clip;
  }

  /** The clip being heard now and how far into its ORIGINAL timeline (for
   *  its lip sync), or null between clips. */
  current(): { clip: Scheduled<Meta>; position: number } | null {
    const at = this.heardTime();
    for (const clip of this.clips) {
      if (!clip.over && at >= clip.startAt && at < clip.endAt) {
        return { clip, position: clip.offset + (at - clip.startAt) };
      }
    }
    return null;
  }

  /** How far through its sound a clip is now, 0 to 1. */
  heard(clip: Scheduled<Meta>): number {
    return Math.min(1, Math.max(0, (this.heardTime() - clip.startAt) / clip.duration));
  }

  /** Silence everything on the track, faded; the clips are dropped. */
  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const clip of this.clips) {
      clip.over = true;
      clip.source.onended = null;
      try {
        clip.gain.gain.setValueAtTime(clip.gain.gain.value, now);
        clip.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
        clip.source.stop(now + FADE_S);
      } catch {
        // already stopped
      }
    }
    this.clips = [];
  }

  /** Milliseconds from now until a context time (for timers). */
  msUntil(contextTime: number): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return Math.max(0, (contextTime - ctx.currentTime) * 1000);
  }

  /** The context time `ms` from now. */
  inMs(ms: number): number {
    return (this.ctx?.currentTime ?? 0) + Math.max(0, ms) / 1000;
  }
}
