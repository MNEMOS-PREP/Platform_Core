/**
 * Live captions from M11's recogniser — FR-11.3 (v0.25.0).
 *
 * Where the browser has its own speech recognition (Chrome, Edge), the room
 * captions the student with it, as it has since day 3: at once, and free.
 * Where it has none (Firefox, Safari, a phone's in-app browser), this does:
 * while the student speaks, every 2.5 s the last ten seconds of their turn go
 * to M11 and come back as words — each marked where the recogniser was unsure
 * (spec §8: "low-confidence words in a lighter weight") — and the caption
 * shows them. The words of record are still the whole turn, written once it
 * ends (`useTurnTaking`); the caption is only ever a caption.
 *
 * Ten seconds every 2.5: about four times the turn's length in recognition,
 * paid only by browsers that cannot caption for free.
 */
import { useEffect, useRef, useState } from "react";

import { transcribeOnServer } from "./asr";
import { CAPTION_EVERY_MS, CAPTION_WINDOW_MS, captionFrom, type Caption } from "./captionWords";
import { nowMs } from "./ledger";

export { CAPTION_EVERY_MS, CAPTION_WINDOW_MS, UNSURE_BELOW, captionFrom } from "./captionWords";
export type { Caption, CaptionWord } from "./captionWords";

/** While `from()` gives a time — the start of the turn being spoken —
 *  caption its last ten seconds, every 2.5 s. Null between turns. */
export function useRollingCaption(options: {
  enabled: boolean;
  from: () => number | null;
  audioBetween: (from: number, to: number) => Blob | null;
  context?: () => string | null | undefined;
}): Caption | null {
  const [caption, setCaption] = useState<Caption | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!options.enabled) {
      setCaption(null);
      return;
    }
    let stopped = false;
    let busy = false;
    const timer = window.setInterval(() => {
      const start = latest.current.from();
      if (start === null) {
        setCaption(null);
        return;
      }
      if (busy) return;
      const now = nowMs();
      const from = Math.max(start - 300, now - CAPTION_WINDOW_MS);
      const audio = latest.current.audioBetween(from, now);
      if (!audio) return;
      busy = true;
      transcribeOnServer(audio, latest.current.context?.())
        .then((result) => {
          // A caption for a turn that has since ended is nobody's caption.
          if (!stopped && latest.current.from() === start) setCaption(captionFrom(result, from > start - 300));
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, CAPTION_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [options.enabled]);

  return caption;
}
