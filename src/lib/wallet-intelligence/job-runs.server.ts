import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emptyCounters, finalStatus, sanitizeError } from "./jobs";
import type { JobCounters } from "./types";

/** Atomic interval lock shared by all worker jobs (DB function; safe under concurrent invocations). */
export async function tryLock(job: string, everyMs: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("wie_try_lock", {
    _job: job,
    _every_ms: Math.round(everyMs),
  });
  if (error) {
    console.error("wie_try_lock", sanitizeError(error));
    return false;
  }
  return data === true;
}

/** Runs `fn` as a logged job: running -> success/failed, with counters, duration and a sanitized error. */
export async function withJobRun<T>(
  job: string,
  source: string,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  const started = Date.now();
  const { data: row } = await supabaseAdmin
    .from("wie_job_runs")
    .insert({ job_name: job, source })
    .select("id")
    .single();
  let result: T | undefined,
    fatal: unknown = null;
  try {
    result = await fn();
  } catch (e) {
    fatal = e;
  }
  // Existing jobs report failures as `{ error }` instead of throwing.
  if (
    !fatal &&
    result &&
    typeof result === "object" &&
    typeof (result as { error?: unknown }).error === "string"
  )
    fatal = (result as unknown as { error: string }).error;
  const c = { ...emptyCounters(), ...pick(result) };
  const skipped = !fatal && result == null;
  if (row?.id) {
    await supabaseAdmin
      .from("wie_job_runs")
      .update({
        ...c,
        status: skipped ? "skipped" : finalStatus(c, fatal),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        error_summary: fatal ? sanitizeError(fatal) : null,
      })
      .eq("id", row.id);
  }
  if (fatal && result === undefined) return { error: sanitizeError(fatal) };
  return result as T;
}

function pick(r: unknown): Partial<JobCounters> {
  if (!r || typeof r !== "object") return {};
  const o = r as Record<string, unknown>;
  const out: Partial<JobCounters> = {};
  for (const k of [
    "records_seen",
    "records_inserted",
    "records_updated",
    "records_skipped",
    "error_count",
  ] as const)
    if (typeof o[k] === "number") out[k] = o[k] as number;
  return out;
}
