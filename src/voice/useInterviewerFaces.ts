/**
 * Which interviewers have a face (v0.27.0): M11's `/v1/voice/faces`, asked
 * once per page. Anyone not listed is drawn instead (the drawn face), and so
 * is everyone when M11 cannot be asked.
 */
import { useEffect, useState } from "react";

import { api } from "../lib/api";

interface FacesResponse {
  faces: { persona: string; ai_generated: boolean }[];
}

let asked: Promise<ReadonlySet<string>> | null = null;

function ask(): Promise<ReadonlySet<string>> {
  asked ??= api
    .get<FacesResponse>("/v1/voice/faces")
    .then((body) => new Set((body?.faces ?? []).map((face) => face.persona)))
    .catch(() => new Set<string>());
  return asked;
}

/** The persona ids with a head, or null while the answer is on its way. */
export function useInterviewerFaces(): ReadonlySet<string> | null {
  const [faces, setFaces] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let live = true;
    void ask().then((set) => {
      if (live) setFaces(set);
    });
    return () => {
      live = false;
    };
  }, []);
  return faces;
}
