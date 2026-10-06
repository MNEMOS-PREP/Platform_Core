/**
 * Thin fetch wrapper.
 *
 * In dev, Vite proxies /v1 to the backend (see vite.config.ts), so requests are
 * same-origin and there is no CORS to think about. In production set
 * VITE_API_BASE to the API origin.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "";

/** A request that never reached the server — no network — as against one
 *  the server answered with a refusal (`ApiError`). EC-11.15: an answer that
 *  could not be sent offline is kept and sent when the network is back. */
export function isOffline(err: unknown): boolean {
  if (err instanceof ApiError) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err instanceof TypeError;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${status}: ${detail}`);
    this.name = "ApiError";
  }
}

/**
 * Who the browser is, on every request.
 *
 * Backends resolve a caller through `ai_core.identity` and refuse
 * candidate-scoped data without one. That check is worthless if the frontend
 * does not say who is asking — so identity headers belong on the ONE fetch
 * wrapper every module already uses, rather than on twenty-two call sites per
 * module across nineteen repos.
 *
 * Written by `session.ts` (v0.12.0) whenever someone signs in, out or
 * switches — modules no longer call this themselves. It carries the dev
 * headers, which the backend only honours under `AI_AUTH_MODE=dev`; when a
 * real provider replaces the dev sign-in it sets a token here and nothing else
 * in any module changes.
 */
let identityHeaders: Record<string, string> = {};

export function setIdentityHeaders(headers: Record<string, string>): void {
  identityHeaders = { ...headers };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...identityHeaders,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error body — keep the status text */
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * POST, and the answer as a Blob with its headers — for audio (v0.16.0, M11's
 * `/v1/voice/speak`). Same identity headers and error shape as `request`.
 */
async function postBlob(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ blob: Blob; headers: Headers }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
    signal,
    headers: { "Content-Type": "application/json", ...identityHeaders },
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const parsed = await response.json();
      detail = parsed.detail ?? detail;
    } catch {
      /* non-JSON error body — keep the status text */
    }
    throw new ApiError(response.status, detail);
  }
  return { blob: await response.blob(), headers: response.headers };
}

/** POST audio itself — a WAV or WebM body — and read JSON back (v0.19.0,
 *  M11's `/v1/voice/transcribe`). Same identity headers and error shape. */
function postAudio<T>(path: string, audio: Blob, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: audio,
    signal,
    headers: { "Content-Type": audio.type || "audio/wav" },
  });
}

/** GET a Blob — kept audio (v0.23.0, M11's `/v1/voice/{s}/audio/{t}`).
 *  Same identity headers and error shape as `request`. */
async function getBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`${BASE}${path}`, { signal, headers: { ...identityHeaders } });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, detail);
  }
  return response.blob();
}

export const api = {
  postBlob,
  postAudio,
  getBlob,
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
