// WIE V2.1 Phase 6–7 worker jobs: wallet graph (6h), gate (5m), backtest (24h). Simulation only.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tryLock, withJobRun } from "./job-runs.server";
import { sanitizeError } from "./jobs";
import { buildRelations, relationshipScore, type GraphEvent } from "./graph";
import { evaluateGate } from "./gate";
import { runBacktest, BACKTEST_VERSION, type BtSignal } from "./backtest";
import type { HorizonSample } from "./signals";

export async function runGraphJob() {
  if (!(await tryLock("wie-graph", 6 * 3_600_000))) return null;
  const { data: tags } = await supabaseAdmin.from("wallet_tags").select("address");
  const tracked = new Set((tags ?? []).map((t) => t.address));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin.from("wallet_events")
    .select("wallet, signature, block_time, activity, mint, direction, sol_amount, raw_ref")
    .in("activity", ["sol_transfer", "buy"]).eq("parse_status", "ok").gte("first_seen_at", since).limit(5000);
  if (error) throw new Error(`graph events: ${error.message}`);
  const evs: GraphEvent[] = (data ?? []).map((e) => ({
    ...e, sol_amount: e.sol_amount != null ? Number(e.sol_amount) : null,
    counterparty: ((e.raw_ref ?? {}) as { counterparty?: string | null }).counterparty ?? null,
  }));
  const rels = buildRelations(evs, tracked).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  let error_count = 0;
  for (let i = 0; i < rels.length; i += 200) {
    const { error: e } = await supabaseAdmin.from("wallet_relations").upsert(rels.slice(i, i + 200), { onConflict: "wallet_a,wallet_b,relation" });
    if (e) { error_count++; console.error("relations upsert", sanitizeError(e)); }
  }
  return { records_seen: evs.length, records_updated: error_count ? 0 : rels.length, error_count };
}

export async function runGateJob() {
  if (!(await tryLock("wie-gate", 5 * 60_000))) return null;
  const { data: sigs } = await supabaseAdmin.from("wallet_signals")
    .select("id, wallet, signal_at, entry_status, delay_sec, risk_score, risk_confidence, liquidity_usd, execution")
    .is("gate_decision", null).limit(200);
  if (!sigs?.length) return { records_seen: 0 };
  const wallets = [...new Set(sigs.map((s) => s.wallet))];
  const [{ data: scores }, { data: relsA }, { data: relsB }] = await Promise.all([
    supabaseAdmin.from("wallet_score_history").select("wallet, score, confidence, tokens_closed, scored_at").in("wallet", wallets).order("scored_at", { ascending: false }),
    supabaseAdmin.from("wallet_relations").select("wallet_a, wallet_b, status, confidence").in("wallet_a", wallets),
    supabaseAdmin.from("wallet_relations").select("wallet_a, wallet_b, status, confidence").in("wallet_b", wallets),
  ]);
  const rels = [...(relsA ?? []), ...(relsB ?? [])];
  const now = new Date().toISOString();
  let records_updated = 0, error_count = 0;
  for (const s of sigs) {
    // Only score history known at signal time (no look-ahead).
    const sc = (scores ?? []).find((x) => x.wallet === s.wallet && x.scored_at <= s.signal_at) ?? null;
    const ex = (s.execution ?? {}) as { copyable?: "yes" | "no" | "unknown" };
    const g = evaluateGate({
      walletScore: sc?.score ?? null, walletConfidence: sc?.confidence ?? null, walletTrades: sc?.tokens_closed ?? null,
      entryStatus: s.entry_status as "EARLY", delaySec: s.delay_sec, riskScore: s.risk_score, riskConfidence: s.risk_confidence,
      liquidityUsd: s.liquidity_usd != null ? Number(s.liquidity_usd) : null, copyable: ex.copyable ?? "unknown",
      relationshipScore: relationshipScore(rels.filter((r) => r.wallet_a === s.wallet || r.wallet_b === s.wallet) as never),
      signalAt: s.signal_at, evaluatedAt: now,
    });
    const { error } = await supabaseAdmin.from("wallet_signals").update({ gate_decision: g.decision, gate: g, gate_at: now }).eq("id", s.id).is("gate_decision", null);
    if (error) error_count++; else records_updated++;
  }
  return { records_seen: sigs.length, records_updated, error_count };
}

export async function runBacktestJob() {
  if (!(await tryLock("wie-backtest", 24 * 3_600_000))) return null;
  const { data } = await supabaseAdmin.from("wallet_signals").select("signal_at, gate_decision, horizons, execution").not("gate_decision", "is", null).order("signal_at").limit(5000);
  const rows = data ?? [];
  let inserted = 0;
  for (const h of ["15m", "1h", "24h"]) {
    const sig: BtSignal[] = rows.map((r) => {
      const s = ((r.horizons ?? {}) as Record<string, HorizonSample>)[h];
      return { signal_at: r.signal_at, decision: r.gate_decision, finished: !!s, ret_pct: s?.ret_pct ?? null, cost_pct: ((r.execution ?? {}) as { roundTripCostPct?: number | null }).roundTripCostPct ?? null };
    });
    const bt = runBacktest(sig);
    const { error } = await supabaseAdmin.from("wie_backtests").insert({
      backtest_version: BACKTEST_VERSION, horizon: h, params: { trainShare: 0.6, minTest: 20, missingPrice: "-100%" },
      train_from: bt.train.from, train_to: bt.train.to, test_from: bt.test.from, test_to: bt.test.to,
      train: bt.train, test: bt.test, baseline: bt.baseline, warnings: bt.warnings,
    });
    if (!error) inserted++;
  }
  return { records_seen: rows.length, records_inserted: inserted };
}

export async function runWiePhase678() {
  return {
    graph: await withJobRun("wie-graph", "cron", runGraphJob),
    gate: await withJobRun("wie-gate", "cron", runGateJob),
    backtest: await withJobRun("wie-backtest", "cron", runBacktestJob),
  };
}
