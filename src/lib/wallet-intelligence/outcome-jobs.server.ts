// WIE V2.1 Phase 2 & 3 — server-side DB adapters for outcome engine + scoring v2.
// Never imported at module scope by client-side files.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeOutcomes, type WalletOutcome, OUTCOME_VERSION } from "./outcomes";
import { runScoringV2, type ScoredPerf, SCORE_VERSION, SCORE_OUTCOME_LIMIT } from "./scoring-v2";
import { tryLock, withJobRun } from "./job-runs.server";
import { sanitizeError } from "./jobs";

const OUTCOME_EVERY = 60 * 60_000;   // 1h
const SCORE_EVERY   = 6 * 60 * 60_000; // 6h

// ────────────────────────────────────────────────────────────
// Phase 2: Outcome Engine job
// ────────────────────────────────────────────────────────────

export async function runOutcomeJob() {
  if (!(await tryLock("wie-outcomes", OUTCOME_EVERY))) return null;

  // Fetch all unique wallets that have buy/sell events.
  const { data: walletRows, error: wErr } = await supabaseAdmin
    .from("wallet_events")
    .select("wallet")
    .in("activity", ["buy", "sell", "token_transfer"])
    .limit(5000);
  if (wErr) throw new Error(`outcome fetch wallets: ${wErr.message}`);

  const wallets = [...new Set((walletRows ?? []).map((r) => r.wallet))];
  if (!wallets.length) return { wallets: 0, events_seen: 0, outcomes_written: 0, error_count: 0 };

  let events_seen = 0, outcomes_written = 0, error_count = 0;

  for (const wallet of wallets) {
    try {
      // Fetch all buy/sell events for this wallet ordered chronologically.
      const { data: evRows, error: evErr } = await supabaseAdmin
        .from("wallet_events")
        .select("wallet, mint, activity, sol_amount, token_amount, direction, block_time, parse_status")
        .eq("wallet", wallet)
        .in("activity", ["buy", "sell", "token_transfer"])
        .not("mint", "is", null)
        .order("block_time", { ascending: true });
      if (evErr) { error_count++; continue; }

      const events = evRows ?? [];
      events_seen += events.length;
      if (!events.length) continue;

      const outcomes = computeOutcomes(wallet, events);
      if (!outcomes.length) continue;

      // Upsert outcomes; on conflict (wallet, mint) update aggregates.
      const rows: WalletOutcome[] = outcomes.map((o) => ({
        ...o,
        outcome_version: OUTCOME_VERSION,
        computed_at: new Date().toISOString(),
      }));

      const { error: upErr } = await supabaseAdmin
        .from("wallet_outcomes")
        .upsert(rows, { onConflict: "wallet,mint" });
      if (upErr) { error_count++; continue; }
      outcomes_written += rows.length;
    } catch (e) {
      console.error("outcome-job wallet", wallet, sanitizeError(e));
      error_count++;
    }
  }

  return { wallets: wallets.length, events_seen, outcomes_written, error_count };
}

// ────────────────────────────────────────────────────────────
// Phase 3: Scoring v2 job
// ────────────────────────────────────────────────────────────

export async function runScoringJob() {
  if (!(await tryLock("wie-score", SCORE_EVERY))) return null;

  // Score every wallet that has at least 1 closed outcome.
  const { data: wRows, error: wErr } = await supabaseAdmin
    .from("wallet_outcomes")
    .select("wallet")
    .eq("is_closed", true)
    .limit(2000);
  if (wErr) throw new Error(`scoring fetch wallets: ${wErr.message}`);

  const wallets = [...new Set((wRows ?? []).map((r) => r.wallet))];
  if (!wallets.length) return { wallets: 0, scored: 0, skipped: 0, error_count: 0 };

  const result = await runScoringV2(wallets, {
    fetchClosedOutcomes: async (wallet, limit) => {
      const { data, error } = await supabaseAdmin
        .from("wallet_outcomes")
        .select("roi, hold_sec, sol_spent, computed_at")
        .eq("wallet", wallet)
        .eq("is_closed", true)
        .not("roi", "is", null)
        .not("hold_sec", "is", null)
        .order("computed_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        roi: Number(r.roi),
        hold_sec: r.hold_sec!,
        sol_spent: Number(r.sol_spent),
        computed_at: r.computed_at,
      }));
    },

    saveScoreHistory: async (wallet, perf) => {
      const { error } = await supabaseAdmin.from("wallet_score_history").insert({
        wallet,
        win_rate: perf.win_rate,
        avg_roi: perf.avg_roi,
        hold_sec: perf.hold_sec,
        tokens_closed: perf.tokens_closed,
        confidence: perf.confidence,
        score: perf.score,
        cls: perf.cls,
        score_version: SCORE_VERSION,
      });
      return !error;
    },

    updateWalletTagPerf: async (wallet, perf) => {
      // Update perf on every user's wallet_tags row that has this address.
      const perfJson: ScoredPerf = { ...perf };
      const { error } = await supabaseAdmin
        .from("wallet_tags")
        .update({ perf: perfJson as never })
        .eq("address", wallet);
      if (error) throw new Error(error.message);
    },
  });

  return result;
}

/** Convenience: run both outcome + scoring in sequence (called from cluster worker). */
export async function runWiePhase23() {
  const outcomes = await withJobRun("wie-outcomes", "cron", runOutcomeJob);
  const scoring  = await withJobRun("wie-score",    "cron", runScoringJob);
  return { outcomes, scoring };
}
