/**
 * Who is signed in — one answer for the whole page.
 *
 * ── Why this is here ────────────────────────────────────────────────────────
 * `setIdentityHeaders` is one setting for the page, and until v0.12.0 four
 * modules each wrote it from their own copy of "who is the student": M01's
 * `candidate.ts`, then M02's, M06's and M15's, each with its own localStorage
 * key and its own default. Mounted together in Platform_Shell the student was
 * whoever's module loaded last, and the placement cell's screens were gated by
 * a `?staff=1` flag in one module and by nothing in another. A session is a
 * platform fact; it lives beside the fetch wrapper it configures.
 *
 * ── What it is, honestly ────────────────────────────────────────────────────
 * The DEV session: a role and an id, sent as the headers the backends honour
 * only under `AI_AUTH_MODE=dev`. It is not authentication. PLATFORM_TODO §1
 * specifies the real sign-in (a provider behind `ai_core.identity`'s Resolver);
 * when it lands, `signIn` is fed by the provider instead of a picker, and no
 * module changes — they already read `getSession()`.
 */

import { useSyncExternalStore } from "react";

import { setIdentityHeaders } from "./api";

/** `ai_core.identity.Role`. Closed, as there: a role one screen invents is a
 *  role eighteen backends cannot refuse. */
export type Role = "student" | "placement_officer" | "researcher" | "admin";
export const ROLES: readonly Role[] = ["student", "placement_officer", "researcher", "admin"];
/** Who staff screens are for. Matches the backends' `require_role` gates. */
export const STAFF_ROLES: readonly Role[] = ["placement_officer", "admin"];

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  placement_officer: "Placement officer",
  researcher: "Researcher",
  admin: "Administrator",
};

export interface Session {
  role: Role;
  /** Stable id for this person. For a student it IS their candidate id. */
  subject: string;
  /** For display only. Never sent, never trusted. */
  name?: string;
}

/**
 * The student every module's seed shares — M01 `Backend/seed.py`'s first
 * candidate. It was a constant in four modules' `candidate.ts`; it is one here.
 */
export const SEEDED_CANDIDATE_ID = "4d0aa1c0-0000-4000-8000-000000000004";

const KEY = "ai.session";
/** What each module stored before there was one session. Read once, in this
 *  order (M06 and M15 already preferred M01's), so nobody's browser loses the
 *  student they were. The last is M15's per-browser random id. */
const LEGACY_KEYS = [
  "m01.candidateId",
  "m06.candidateId",
  "m02.candidateId",
  "ai-interviewer.candidate-id",
];

const listeners = new Set<() => void>();
let current: Session | null = load();
publish();

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // private mode, blocked site data
  }
}

function load(): Session | null {
  if (typeof window === "undefined") return null;

  // `?candidate=<id>` — a link to one student's view. For this page load only,
  // as each module's control always treated it.
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("candidate");
  // `?as=<role>` — a bookmarkable way in for staff (replaces M15's `?staff=1`).
  const asRole = params.get("as");
  if (isRole(asRole)) {
    const session: Session = {
      role: asRole,
      subject: asRole === "student" ? fromUrl || SEEDED_CANDIDATE_ID : `${asRole}-dev`,
    };
    save(session);
    return session;
  }
  if (fromUrl) return { role: "student", subject: fromUrl };

  const store = storage();
  try {
    const raw = store?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Session>;
      if (isRole(parsed.role) && typeof parsed.subject === "string" && parsed.subject) {
        return { role: parsed.role, subject: parsed.subject, name: parsed.name };
      }
    }
  } catch {
    /* a corrupt value is a signed-out browser, not a crash */
  }
  for (const legacy of LEGACY_KEYS) {
    const id = store?.getItem(legacy);
    if (id) {
      const migrated: Session = { role: "student", subject: id };
      save(migrated);
      return migrated;
    }
  }
  return null;
}

function save(session: Session | null): void {
  const store = storage();
  try {
    if (session) store?.setItem(KEY, JSON.stringify(session));
    else store?.removeItem(KEY);
  } catch {
    /* the session still holds for this page */
  }
}

function publish(): void {
  setIdentityHeaders(sessionHeaders(current));
}

function changed(): void {
  publish();
  listeners.forEach((listener) => listener());
}

export function getSession(): Session | null {
  return current;
}

export function signIn(session: Session): void {
  const subject = session.subject.trim();
  if (!isRole(session.role) || !subject) return;
  const next = { ...session, subject };
  if (current && current.role === next.role && current.subject === next.subject) {
    if (current.name === next.name) return;
  }
  current = next;
  save(current);
  changed();
}

export function signOut(): void {
  if (current === null) return;
  current = null;
  save(null);
  changed();
}

/**
 * For a module's STANDALONE entry point: sign in as `fallback` only if nobody
 * is. The shell never calls it — there, signed out means the sign-in screen.
 */
export function ensureSession(fallback: Session): void {
  if (current === null) signIn(fallback);
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The session, re-rendering on sign-in, sign-out and switch. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, getSession, () => null);
}

/** The candidate this session IS, when it is a student's. */
export function candidateIdOf(session: Session | null = current): string | null {
  return session?.role === "student" ? session.subject : null;
}

export function isStaff(session: Session | null = current): boolean {
  return session !== null && STAFF_ROLES.includes(session.role);
}

/**
 * The headers this session sends. For a raw `fetch` or an EventSource
 * polyfill that cannot go through `api` — everything else gets them already.
 */
export function sessionHeaders(session: Session | null = current): Record<string, string> {
  if (!session) return {};
  return { "X-Role": session.role, "X-Candidate-Id": session.subject };
}
