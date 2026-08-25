/**
 * The module registry.
 *
 * Mirrors plan_in_depth/README.md and PORTS.txt. `live: true` means the module
 * has a real UI; the rest render an honest "not built yet" placeholder rather
 * than a dead link.
 *
 * ── Keep this honest, and check it against the disk ─────────────────────────
 * M01, M02 and M13 shipped frontends and this file went on saying `live: false`
 * for all three. Two consumers had already noticed and worked around it rather
 * than fixing it: `Platform_Shell` carries a hardcoded `BUILT` set with a
 * comment reading *"the registry's own `live` flags are stale"*, and M15's home
 * page — which trusts the registry — rendered three working modules under
 * "Specified, not built" and told every visitor "1 of 19 built" when it was 4.
 *
 * A registry that lies is worse than no registry, because everything
 * downstream repeats it with confidence. `live` means EXACTLY one thing: a
 * `frontend_M*` package exists and mounts routes. M04 and M05 have backends and
 * no UI, so they stay false — a running API is not a screen.
 *
 * `path` is where the module lands IN THE SHELL, which is not always its
 * standalone route: M01 and M02 both claim the index route in their own repos,
 * so the shell mounts their entry screens at /resume and /jd.
 */

export interface ModuleInfo {
  id: string;
  num: number;
  name: string;
  phase: string;
  owner: string;
  path: string;
  live: boolean;
  blurb: string;
}

export const MODULES: ModuleInfo[] = [
  { id: "M01", num: 1, name: "Resume Ingestion", phase: "1", owner: "E3", path: "/resume", live: true, blurb: "Pull verifiable claims out of your resume." },
  { id: "M02", num: 2, name: "JD Parser", phase: "1", owner: "E3", path: "/jd", live: true, blurb: "Turn a job description into a coverage plan." },
  { id: "M03", num: 3, name: "GitHub Analyzer", phase: "1", owner: "E3", path: "/m03", live: false, blurb: "Evidence from what you actually built." },
  { id: "M04", num: 4, name: "Skill Graph", phase: "1", owner: "E3", path: "/m04", live: false, blurb: "What you know, tracked over time." },
  { id: "M05", num: 5, name: "Question Intelligence", phase: "1–2", owner: "E3", path: "/m05", live: false, blurb: "The question bank, adapted to your level." },
  { id: "M06", num: 6, name: "Mock Interview", phase: "1–2", owner: "E2", path: "/m06", live: false, blurb: "The front door: a real practice interview." },
  { id: "M07", num: 7, name: "Live Coding", phase: "1", owner: "E2", path: "/m07", live: false, blurb: "Code under time, judged automatically." },
  { id: "M08", num: 8, name: "System Design", phase: "2", owner: "E2", path: "/m08", live: false, blurb: "Draw an architecture and defend it." },
  { id: "M09", num: 9, name: "ML / Research Viva", phase: "2", owner: "E1", path: "/m09", live: false, blurb: "Get interrogated on your own project." },
  { id: "M10", num: 10, name: "Aptitude & OA", phase: "2", owner: "E3", path: "/m10", live: false, blurb: "Timed aptitude in real OA formats." },
  { id: "M11", num: 11, name: "Voice Engine", phase: "3", owner: "E2", path: "/m11", live: false, blurb: "Speak your answers, not type them." },
  { id: "M12", num: 12, name: "Multimodal Suite", phase: "3", owner: "E1+E3", path: "/m12", live: false, blurb: "How you come across, measured fairly." },
  { id: "M13", num: 13, name: "Evaluation Engine", phase: "1", owner: "E1", path: "/score", live: true, blurb: "Scores you can trace to evidence." },
  { id: "M14", num: 14, name: "GD Arena", phase: "3", owner: "E2", path: "/m14", live: false, blurb: "Group discussion practice." },
  { id: "M15", num: 15, name: "Company Guider", phase: "3", owner: "E3", path: "/companies", live: true, blurb: "What this company actually asks — with sources." },
  { id: "M16", num: 16, name: "Counselor", phase: "4", owner: "E3", path: "/m16", live: false, blurb: "A study plan for the days you have left." },
  { id: "M17", num: 17, name: "Communication Coach", phase: "3", owner: "E1", path: "/m17", live: false, blurb: "Clarity, pace, filler words." },
  { id: "M18", num: 18, name: "Integrity", phase: "3", owner: "E2", path: "/m18", live: false, blurb: "Fair proctoring, no false accusations." },
  { id: "M19", num: 19, name: "Reports", phase: "2–4", owner: "E3", path: "/m19", live: false, blurb: "Your evidence ledger and progress." },
];

export const LIVE_MODULES = MODULES.filter((m) => m.live);
export const PLANNED_MODULES = MODULES.filter((m) => !m.live);
