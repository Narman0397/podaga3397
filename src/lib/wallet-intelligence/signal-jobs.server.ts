// WIE V2.1 Phase 4–5 worker job: turns new buy events into signals, then evaluates horizons with
// a token-risk re-check. Paper/simulation data only — never executes trades.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tryLock, withJobRun } from "./job-runs.server";
import { sanitizeError } from "./jobs";
import { isQuoteMint } from "./normalize";
import {
  SIGNAL_VERSION, evaluateEntry, tokenRisk, estimateExecution, dueHorizons, excursions, retPct,
  type HorizonSample,
} from "./signals";

const EVERY = 5 * 60_000;
const NEW_EVENT_WINDOW_H = 24;
const SIM_SIZE_SOL = 0.2;
const SOL = "So11111111111111111111111111111111111111112";

type Mkt = { priceSol: number | null; liqUsd: number | null; vol24: number | null; ageMin: number | null };

async function solUsd(): Promise<number | null> {
  const d = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL}`).then((r) => r.json()).catch(() => null);
  const p = ((d?.pairs ?? []) as { quoteToken?: { symbol?: string }; priceUsd?: string; liquidity?: { usd?: number } }[])
    .filter((x) => /USD/.test(x.quoteToken?.symbol ?? "")).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const v = Number(p?.priceUsd);
  return v > 0 ? v : null;
}

/** Best SOL-quoted pair per mint (deepest liquidity). Missing data stays null. */
async function market(mints: string[]): Promise<Map<string, Mkt>> {
  const out = new Map<string, Mkt>();
  for (let i = 0; i < mints.length; i += 30) {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.slice(i, i + 30).join(",")}`).then((x) => x.json()).catch(() => null);
    type P = { baseToken: { address: string }; quoteToken?: { address?: string }; priceNative?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; pairCreatedAt?: number };
    for (const p of (r?.pairs ?? []) as P[]) {
      if (p.quoteToken?.address !== SOL) continue;
      const cur = out.get(p.baseToken.address);
      if (cur && (cur.liqUsd ?? 0) >= (p.liquidity?.usd ?? 0)) continue;
      const px = Number(p.priceNative);
      out.set(p.baseToken.address, {
        priceSol: px > 0 ? px : null,
        liqUsd: p.liquidity?.usd ?? null,
        vol24: p.volume?.h24 ?? null,
        ageMin: p.pairCreatedAt ? Math.round((Date.now() - p.pairCreatedAt) / 60_000) : null,
      });
    }
  }
  return out;
}

export async function runSignalJob(force = false) {
  if (!force && !(await tryLock("wie-signals", EVERY))) return null;
  let records_seen = 0, records_inserted = 0, records_updated = 0, records_skipped = 0, error_count = 0;
  const now = new Date();
  const sol = await solUsd();

  // 1) New buy events → signals (only data known now).
  const since = new Date(Date.now() - NEW_EVENT_WINDOW_H * 3_600_000).toISOString();
  const { data: evs, error } = await supabaseAdmin
    .from("wallet_events")
    .select("wallet, mint, signature, block_time, first_seen_at, price_sol")
    .eq("activity", "buy").eq("parse_status", "ok").not("mint", "is", null)
    .gte("first_seen_at", since).limit(300);
  if (error) throw new Error(`signals fetch events: ${error.message}`);
  records_seen += evs?.length ?? 0;
  if (evs?.length) {
    const { data: existing } = await supabaseAdmin.from("wallet_signals").select("signature, wallet, mint").in("signature", evs.map((e) => e.signature));
    const have = new Set((existing ?? []).map((x) => `${x.signature}:${x.wallet}:${x.mint}`));
    const fresh = evs.filter((e) => !isQuoteMint(e.mint) && !have.has(`${e.signature}:${e.wallet}:${e.mint}`));
    records_skipped += evs.length - fresh.length;
    const mk = await market([...new Set(fresh.map((e) => e.mint!))]);
    const rows = fresh.map((e) => {
      const m = mk.get(e.mint!) ?? { priceSol: null, liqUsd: null, vol24: null, ageMin: null };
      const src = e.price_sol != null ? Number(e.price_sol) : null;
      const entry = evaluateEntry({ sourceTxAt: e.block_time, signalAt: now.toISOString(), sourcePriceSol: src, signalPriceSol: m.priceSol });
      const risk = tokenRisk({ liquidityUsd: m.liqUsd, volumeH24Usd: m.vol24, poolAgeMin: m.ageMin });
      const exec = estimateExecution({ sizeSol: SIM_SIZE_SOL, liquidityUsd: m.liqUsd, solUsd: sol, entryMovePct: entry.movePct });
      return {
        wallet: e.wallet, mint: e.mint!, signature: e.signature,
        source_tx_at: e.block_time, detected_at: e.first_seen_at, signal_at: now.toISOString(),
        delay_sec: entry.delaySec, source_price_sol: src, signal_price_sol: m.priceSol, price_move_pct: entry.movePct,
        liquidity_usd: m.liqUsd, volume_h24_usd: m.vol24, pool_age_min: m.ageMin,
        entry_status: entry.status, risk_score: risk.risk, risk_confidence: risk.confidence,
        risk_reasons: [...entry.reasons, ...risk.reasons], execution: exec, signal_version: SIGNAL_VERSION,
      };
    });
    if (rows.length) {
      const { error: insErr } = await supabaseAdmin.from("wallet_signals").upsert(rows, { onConflict: "signature,wallet,mint", ignoreDuplicates: true });
      if (insErr) { error_count++; console.error("signals insert", sanitizeError(insErr)); } else records_inserted += rows.length;
    }
  }

  // 2) Horizon evaluation + risk re-check for signals in the last 25h.
  const { data: open } = await supabaseAdmin
    .from("wallet_signals").select("id, mint, signal_at, signal_price_sol, liquidity_usd, horizons")
    .gte("signal_at", new Date(Date.now() - 25 * 3_600_000).toISOString()).limit(500);
  const pending = (open ?? []).map((s) => ({ s, due: dueHorizons(s.signal_at, (s.horizons ?? {}) as Record<string, HorizonSample>, Date.now()) })).filter((x) => x.due.length);
  if (pending.length) {
    const mk = await market([...new Set(pending.map((p) => p.s.mint))]);
    for (const { s, due } of pending) {
      try {
        const m = mk.get(s.mint);
        const base = s.signal_price_sol != null ? Number(s.signal_price_sol) : null;
        const h = { ...((s.horizons ?? {}) as Record<string, HorizonSample>) };
        for (const d of due)
          h[d.key] = d.missed || !m?.priceSol
            ? { price: null, ret_pct: null, at: null, missed: true }
            : { price: m.priceSol, ret_pct: retPct(base, m.priceSol), at: now.toISOString() };
        const ex = excursions(base, Object.values(h));
        const liqChange = m?.liqUsd != null && s.liquidity_usd ? ((m.liqUsd / Number(s.liquidity_usd)) - 1) * 100 : null;
        const recheck = tokenRisk({ liquidityUsd: m?.liqUsd ?? null, liquidityChangePct: liqChange, volumeH24Usd: m?.vol24 ?? null, poolAgeMin: m?.ageMin ?? null });
        const { error: upErr } = await supabaseAdmin.from("wallet_signals").update({
          horizons: h, mfe_pct: ex.mfe, mae_pct: ex.mae, risk_recheck: { ...recheck, at: now.toISOString() }, updated_at: now.toISOString(),
        }).eq("id", s.id);
        if (upErr) error_count++; else records_updated++;
      } catch (e) { error_count++; console.error("signal horizon", sanitizeError(e)); }
    }
  }
  return { records_seen, records_inserted, records_updated, records_skipped, error_count };
}

export const runWiePhase45 = () => withJobRun("wie-signals", "cron", runSignalJob);
