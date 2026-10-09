/**
 * An interviewer's photo (v0.29.0, 2026-10-09).
 *
 * The user, on the drawn faces: "we don't want dummy faces in an interview,
 * we want realistic human faces". Every interviewer's picture is now their
 * own portrait — the one their 3D head was made from, background removed
 * (M11's `/v1/voice/faces/{persona}.webp`) — on the setup page, the plan, in
 * the transcript, and in the room's tile until the head is ready.
 *
 * Every portrait is AI-generated, never a real person's (spec §15.6): the
 * picture says so to a screen reader and on hover, and a large one carries
 * the "AI" mark. Without a photo (M11 down, or a head still being made) the
 * initials stand in — a name, not a made-up face.
 */
import { useState } from "react";

export interface InterviewerPhotoProps {
  /** M06's persona id: the photo is `/v1/voice/faces/{persona}.webp`. */
  persona: string;
  /** For the initials, and for what a screen reader hears. */
  name: string;
  /** A circle this many pixels across; ignored when `fill`. */
  size?: number;
  /** Ringed while this person speaks. */
  speaking?: boolean;
  /** Fill the parent (a tile) instead of a circle. */
  fill?: boolean;
  className?: string;
}

/** The photo's address. */
export function photoUrl(persona: string): string {
  return `/v1/voice/faces/${encodeURIComponent(persona)}.webp`;
}

/** "Dr. Raghavan" → "R", "Professor Murthy" → "M", "Sunita" → "S". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/^(dr|prof|professor|mr|ms|mrs)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** Photos that failed to load, so a page asks M11 once per person. */
const missing = new Set<string>();

export function InterviewerPhoto({
  persona,
  name,
  size = 36,
  speaking = false,
  fill = false,
  className = "",
}: InterviewerPhotoProps) {
  const [failed, setFailed] = useState(() => !persona || missing.has(persona));
  const label = `${name}, an AI-generated interviewer`;
  const lose = () => {
    missing.add(persona);
    setFailed(true);
  };

  if (fill) {
    return (
      <div className={`relative h-full w-full overflow-hidden bg-surface-sunken ${className}`} title={label}>
        {failed ? (
          <span className="absolute inset-0 grid place-items-center text-3xl font-semibold text-ink-faint">
            {initialsOf(name)}
          </span>
        ) : (
          // The still is the head crop LAM framed: centred, the face upper-middle.
          <img
            src={photoUrl(persona)}
            alt={label}
            draggable={false}
            onError={lose}
            className="absolute inset-0 h-full w-full object-contain object-bottom"
          />
        )}
      </div>
    );
  }

  const ring = speaking ? "ring-2 ring-brand ring-offset-2 ring-offset-surface" : "";
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-sunken ${ring} ${className}`}
      style={{ width: size, height: size }}
      title={label}
      role="img"
      aria-label={label}
    >
      {failed ? (
        <span className="font-semibold text-ink-soft" style={{ fontSize: Math.max(10, size * 0.38) }}>
          {initialsOf(name)}
        </span>
      ) : (
        // The face, not the shoulders: the crop is the head and some of the
        // body, so a circle zooms to the upper middle.
        <img
          src={photoUrl(persona)}
          alt=""
          draggable={false}
          onError={lose}
          className="absolute inset-0 h-full w-full scale-[1.55] object-cover object-[50%_42%]"
          style={{ transformOrigin: "50% 40%" }}
        />
      )}
      {size >= 48 && !failed && (
        <span
          className="absolute right-0 bottom-0 rounded-sm bg-black/60 px-1 text-[0.5rem] font-semibold leading-tight tracking-wide text-white"
          aria-hidden
        >
          AI
        </span>
      )}
    </span>
  );
}
