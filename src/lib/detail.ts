/** What a refusal says, in words. FastAPI's `detail` is a sentence for most
 *  refusals but a list of field errors for a 422 (and an object where a
 *  module sends one); passed through as it was, a student read "422: [object
 *  Object]". */
export function detailOf(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const said = detail
      .map((d) => (typeof d === "string" ? d : (d as { msg?: unknown } | null)?.msg))
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (said.length) return said.join("; ");
  }
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
