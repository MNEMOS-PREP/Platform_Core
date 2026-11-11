/**
 * Which interviewers have a face (v0.27.0): M11's `/v1/voice/faces`, asked
 * once per page. Anyone not listed is drawn instead (the drawn face), and so
 * is everyone while M11 cannot be asked — which is asked again until it can
 * (`facesList.ts`), so a face arrives without a reload.
 */
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { facesCache, facesRetryDelay } from "./facesList";

interface FacesResponse {
  faces: { persona: string; ai_generated: boolean }[];
}

const NOBODY: ReadonlySet<string> = new Set<string>();

const ask = facesCache(() =>
  api.get<FacesResponse>("/v1/voice/faces").then((body) => (body?.faces ?? []).map((face) => face.persona)),
);

/** The persona ids with a head, or null while the first answer is on its way. */
export function useInterviewerFaces(): ReadonlySet<string> | null {
  const [faces, setFaces] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    let attempt = 0;
    const go = () => {
      void ask().then((set) => {
        if (!live) return;
        if (set) {
          setFaces(set);
          return;
        }
        // Drawn faces meanwhile, as before — and ask again.
        setFaces((current) => current ?? NOBODY);
        timer = window.setTimeout(go, facesRetryDelay(attempt++));
      });
    };
    go();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);
  return faces;
}
