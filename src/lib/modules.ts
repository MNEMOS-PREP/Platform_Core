/**
 * The module registry.
 *
 * Mirrors plan_in_depth/README.md and PORTS.txt. `live: true` means the module
 * has a real UI; the rest render an honest "not built yet" placeholder rather
 * than a dead link.
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
  { id: "M01", num: 1, name: "Resume Ingestion", phase: "1", owner: "E3", path: "/m01", live: false, blurb: "Pull verifiable claims out of your resume." },
  { id: "M02", num: 2, name: "JD Parser", phase: "1", owner: "E3", path: "/m02", live: false, blurb: "Turn a job description into a coverage plan." },
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
  { id: "M13", num: 13, name: "Evaluation Engine", phase: "1", owner: "E1", path: "/m13", live: false, blurb: "Scores you can trace to evidence." },
  { id: "M14", num: 14, name: "GD Arena", phase: "3", owner: "E2", path: "/m14", live: false, blurb: "Group discussion practice." },
  { id: "M15", num: 15, name: "Company Guider", phase: "3", owner: "E3", path: "/companies", live: true, blurb: "What this company actually asks — with sources." },
  { id: "M16", num: 16, name: "Counselor", phase: "4", owner: "E3", path: "/m16", live: false, blurb: "A study plan for the days you have left." },
  { id: "M17", num: 17, name: "Communication Coach", phase: "3", owner: "E1", path: "/m17", live: false, blurb: "Clarity, pace, filler words." },
  { id: "M18", num: 18, name: "Integrity", phase: "3", owner: "E2", path: "/m18", live: false, blurb: "Fair proctoring, no false accusations." },
  { id: "M19", num: 19, name: "Reports", phase: "2–4", owner: "E3", path: "/m19", live: false, blurb: "Your evidence ledger and progress." },
];

export const LIVE_MODULES = MODULES.filter((m) => m.live);
export const PLANNED_MODULES = MODULES.filter((m) => !m.live);
