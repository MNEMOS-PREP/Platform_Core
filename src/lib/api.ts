/**
 * Thin fetch wrapper.
 *
 * In dev, Vite proxies /v1 to the backend (see vite.config.ts), so requests are
 * same-origin and there is no CORS to think about. In production set
 * VITE_API_BASE to the API origin.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "";

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
 * Set once at startup. Until a real session exists this carries the dev
 * headers, which the backend only honours under `AI_AUTH_MODE=dev`; when
 * `Platform_Shell` grows a login it sets a token here and nothing else in any
 * module changes.
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
