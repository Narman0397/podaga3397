import type { JobCounters } from "./types";

export const emptyCounters = (): JobCounters => ({
  records_seen: 0,
  records_inserted: 0,
  records_updated: 0,
  records_skipped: 0,
  error_count: 0,
});

/** Strip API keys, URLs with query strings, bearer tokens and long base58 blobs before storing an error. */
export function sanitizeError(e: unknown, max = 300): string {
  const raw =
    e instanceof Error
      ? `${e.name}: ${e.message}`
      : typeof e === "string"
        ? e
        : (() => {
            try {
              return JSON.stringify(e);
            } catch {
              return String(e);
            }
          })();
  return raw
    .replace(/api[-_]?key=[^&\s"']+/gi, "api-key=[redacted]")
    .replace(/https?:\/\/[^\s"']+/gi, "[url]")
    .replace(/bearer\s+[\w.-]+/gi, "Bearer [redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .slice(0, max);
}

/** Final status: any error with zero successful writes is "failed"; otherwise success (partial errors are counted). */
export function finalStatus(c: JobCounters, fatal: unknown): "success" | "failed" {
  if (fatal) return "failed";
  if (c.error_count > 0 && c.records_inserted + c.records_updated === 0 && c.records_seen === 0)
    return "failed";
  return "success";
}

export const isStale = (
  finishedAt: string | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
) => !finishedAt || now - Date.parse(finishedAt) > maxAgeMs;
