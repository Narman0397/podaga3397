// WIE V2.1 Phase 4 (early entry + attribution) and Phase 5 (token risk + execution).
// Pure functions only. Unknown inputs stay null and surface as INSUFFICIENT_DATA/unknown, never 0.
import { SWAP_FEE } from "../edge";

export const SIGNAL_VERSION = "wie-sig-1.0.0";

/** Configurable evaluation horizons (seconds). */
export const HORIZONS: Record<string, number> = { "5m": 300, "15m": 900, "1h": 3600, "24h": 86400 };
/** A horizon sample is only valid if taken within this window after it falls due (no stale backfill). */
export const HORIZON_TOLERANCE_SEC = 30 * 60;

export const ENTRY_RULES = {
  /** Source tx older than this when the system first sees it → LATE. */
  maxDelaySec: 15 * 60,
  /** Price already up more than this since the source entry → LATE. */
  maxMovePct: 50,
};

export type EntryStatus = "EARLY" | "LATE" | "INSUFFICIENT_DATA";

export interface EntryInput {
  sourceTxAt: string | null;
  signalAt: string;
  sourcePriceSol: number | null;
  signalPriceSol: number | null;
}

/** Uses only data known at signal time (no future prices). */
export function evaluateEntry(i: EntryInput, rules = ENTRY_RULES) {
  const delaySec = i.sourceTxAt ? Math.max(0, Math.round((Date.parse(i.signalAt) - Date.parse(i.sourceTxAt)) / 1000)) : null;
  const movePct =
    i.sourcePriceSol && i.sourcePriceSol > 0 && i.signalPriceSol && i.signalPriceSol > 0
      ? +(((i.signalPriceSol / i.sourcePriceSol) - 1) * 100).toFixed(2)
      : null;
  const reasons: string[] = [];
  let status: EntryStatus;
  if (delaySec == null || i.signalPriceSol == null || i.signalPriceSol <= 0) {
    status = "INSUFFICIENT_DATA";
    reasons.push(delaySec == null ? "waktu transaksi sumber tidak diketahui" : "harga saat sinyal tidak tersedia");
  } else {
    if (delaySec > rules.maxDelaySec) reasons.push(`delay ${Math.round(delaySec / 60)} menit > ${rules.maxDelaySec / 60} menit`);
    if (movePct != null && movePct > rules.maxMovePct) reasons.push(`harga sudah naik ${movePct}% sejak wallet masuk`);
    status = reasons.length ? "LATE" : "EARLY";
  }
  return { delaySec, movePct, status, reasons };
}

// ─── Phase 5: token risk ────────────────────────────────────

export interface RiskInput {
  liquidityUsd: number | null;
  liquidityChangePct?: number | null;
  volumeH24Usd: number | null;
  poolAgeMin: number | null;
  top10Pct?: number | null;
}

/**
 * Documented, additive risk rules (0 = fewer warning signs, 100 = many). Risk is separate from
 * confidence (share of inputs actually known). Low risk is not a safety guarantee.
 */
export function tokenRisk(i: RiskInput) {
  const known = [i.liquidityUsd, i.liquidityChangePct, i.volumeH24Usd, i.poolAgeMin, i.top10Pct].filter((v) => v != null).length;
  const confidence = Math.round((known / 5) * 100);
  const reasons: string[] = [];
  let risk = 0;
  if (i.liquidityUsd != null) {
    if (i.liquidityUsd < 5_000) { risk += 35; reasons.push("likuiditas < $5k"); }
    else if (i.liquidityUsd < 20_000) { risk += 15; reasons.push("likuiditas < $20k"); }
  } else reasons.push("likuiditas tidak diketahui");
  if (i.liquidityChangePct != null && i.liquidityChangePct < -30) { risk += 25; reasons.push(`likuiditas turun ${Math.abs(Math.round(i.liquidityChangePct))}%`); }
  if (i.poolAgeMin != null && i.poolAgeMin < 30) { risk += 15; reasons.push("pool berumur < 30 menit"); }
  if (i.volumeH24Usd != null && i.liquidityUsd) {
    const r = i.volumeH24Usd / i.liquidityUsd;
    if (r > 50) { risk += 15; reasons.push(`volume/likuiditas ${r.toFixed(0)}× (tidak biasa)`); }
  }
  if (i.top10Pct != null) {
    if (i.top10Pct > 50) { risk += 25; reasons.push(`top-10 holder ${Math.round(i.top10Pct)}%`); }
  } else reasons.push("data holder tidak tersedia");
  return { risk: known < 2 ? null : Math.min(100, risk), confidence, reasons };
}

// ─── Phase 5: execution intelligence (simulation only) ─────

export interface ExecInput {
  sizeSol: number;
  liquidityUsd: number | null;
  solUsd: number | null;
  entryMovePct: number | null;
  /** Network + priority fee in SOL if known; otherwise left unknown. */
  networkFeeSol?: number | null;
}

/** Constant-product impact estimate on half the pool; fee from SWAP_FEE. Unknown stays null. */
export function estimateExecution(i: ExecInput) {
  const poolSideSol = i.liquidityUsd && i.solUsd ? i.liquidityUsd / 2 / i.solUsd : null;
  const impactPct = poolSideSol ? +((i.sizeSol / (poolSideSol + i.sizeSol)) * 100).toFixed(2) : null;
  const feePct = SWAP_FEE * 100;
  const netFeePct = i.networkFeeSol != null && i.sizeSol > 0 ? +((i.networkFeeSol / i.sizeSol) * 100).toFixed(3) : null;
  // Round trip: entry + exit impact and fees.
  const roundTripCostPct = impactPct != null ? +(2 * (impactPct + feePct) + (netFeePct ?? 0) * 2).toFixed(2) : null;
  let copyable: "yes" | "no" | "unknown" = "unknown";
  const reasons: string[] = [];
  if (roundTripCostPct == null) reasons.push("likuiditas/harga SOL tidak diketahui");
  else {
    if (roundTripCostPct > 10) reasons.push(`biaya pulang-pergi ≈${roundTripCostPct}%`);
    if (i.entryMovePct != null && i.entryMovePct > 50) reasons.push("harga sudah bergerak jauh selama delay");
    copyable = reasons.length ? "no" : "yes";
  }
  if (netFeePct == null) reasons.push("priority fee tidak diketahui");
  return { sizeSol: i.sizeSol, impactPct, feePct, netFeePct, roundTripCostPct, copyable, reasons, mevRisk: "unknown" as const };
}

// ─── Horizons / excursions ──────────────────────────────────

export type HorizonSample = { price: number | null; ret_pct: number | null; at: string | null; missed?: boolean };

/** Returns horizon keys newly due at `now`; samples past tolerance are marked missed (never backfilled). */
export function dueHorizons(signalAt: string, filled: Record<string, HorizonSample>, nowMs: number) {
  const t0 = Date.parse(signalAt);
  const due: { key: string; missed: boolean }[] = [];
  for (const [k, sec] of Object.entries(HORIZONS)) {
    if (filled[k]) continue;
    const dueAt = t0 + sec * 1000;
    if (nowMs < dueAt) continue;
    due.push({ key: k, missed: nowMs - dueAt > HORIZON_TOLERANCE_SEC * 1000 });
  }
  return due;
}

export function excursions(signalPrice: number | null, samples: HorizonSample[]) {
  const rets = samples.map((s) => s.ret_pct).filter((r): r is number => r != null);
  if (signalPrice == null || !rets.length) return { mfe: null, mae: null };
  return { mfe: Math.max(0, ...rets), mae: Math.min(0, ...rets) };
}

export const retPct = (from: number | null, to: number | null) => (from && to && from > 0 ? +(((to / from) - 1) * 100).toFixed(2) : null);

// ─── Phase 4: attribution ───────────────────────────────────

export interface AttribSignal { wallet: string; status: EntryStatus; horizons: Record<string, HorizonSample>; costPct: number | null }

/**
 * Correlational (not causal) predictive value per wallet at one horizon: net return after the system
 * received the signal, minus round-trip cost, compared to the all-signal baseline.
 */
export function attribute(signals: AttribSignal[], horizon = "1h", minSamples = 5) {
  const net = (s: AttribSignal) => {
    const r = s.horizons[horizon]?.ret_pct;
    return r == null ? null : r - (s.costPct ?? 0);
  };
  const all = signals.map(net).filter((x): x is number => x != null);
  const baseline = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  const byWallet = new Map<string, AttribSignal[]>();
  for (const s of signals) byWallet.set(s.wallet, [...(byWallet.get(s.wallet) ?? []), s]);
  return [...byWallet.entries()].map(([wallet, ss]) => {
    const rets = ss.map(net).filter((x): x is number => x != null);
    const n = rets.length;
    const avg = n ? rets.reduce((a, b) => a + b, 0) / n : null;
    const sum = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const outlierShare = n && sum > 0 ? Math.max(...rets) / sum : null;
    return {
      wallet,
      signals: ss.length,
      evaluated: n,
      late: ss.filter((s) => s.status === "LATE").length,
      avgNetPct: avg == null ? null : +avg.toFixed(2),
      hitRate: n ? Math.round((rets.filter((r) => r > 0).length / n) * 100) : null,
      vsBaselinePct: avg == null || baseline == null ? null : +(avg - baseline).toFixed(2),
      outlierDriven: outlierShare != null && n >= 3 && outlierShare > 0.6,
      verdict: n < minSamples ? "INSUFFICIENT_DATA" : avg! > 0 && baseline != null && avg! > baseline ? "PREDICTIVE" : "NOT_PREDICTIVE",
    } as const;
  });
}
