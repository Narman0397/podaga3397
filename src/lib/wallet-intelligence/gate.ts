// WIE V2.1 Phase 7 — Intelligence Gate (pure, deterministic, explained, versioned).
// ACCEPT only opens the paper/simulation path. Never a buy order; no live execution.

export const GATE_VERSION = "wie-gate-1.0.0";

/** Baseline experimental weights (not proven optimal; versioned with GATE_VERSION). */
export const GATE_CONFIG = {
  weights: { alpha: 0.4, early: 0.35, relationship: 0.25 },
  minWalletTrades: 5,
  minWalletConfidence: 40,
  maxRisk: 60,
  minLiquidityUsd: 5_000,
  maxDelaySec: 15 * 60,
  maxSignalAgeSec: 30 * 60,
  acceptScore: 60,
};

export type GateDecision = "ACCEPT" | "WATCH" | "REJECT" | "INSUFFICIENT_DATA";

export interface GateInput {
  walletScore: number | null;
  walletConfidence: number | null;
  walletTrades: number | null;
  entryStatus: "EARLY" | "LATE" | "INSUFFICIENT_DATA";
  delaySec: number | null;
  riskScore: number | null;
  riskConfidence: number;
  liquidityUsd: number | null;
  copyable: "yes" | "no" | "unknown";
  relationshipScore: number | null;
  signalAt: string;
  evaluatedAt: string;
}

export function evaluateGate(i: GateInput, c = GATE_CONFIG) {
  const reasons: string[] = [];
  const missing: string[] = [];
  if (i.walletScore == null) missing.push("skor wallet");
  if (i.liquidityUsd == null) missing.push("likuiditas");
  if (i.riskScore == null) missing.push("risiko token");
  if (i.entryStatus === "INSUFFICIENT_DATA") missing.push("data early entry");
  const dataQuality = Math.round(((4 - missing.length) / 4) * 100);

  const early = i.entryStatus === "EARLY" ? 100 : i.entryStatus === "LATE" ? 20 : null;
  const execution = i.copyable === "yes" ? 100 : i.copyable === "no" ? 0 : null;
  const parts = [
    [i.walletScore, c.weights.alpha],
    [early, c.weights.early],
    [i.relationshipScore, c.weights.relationship],
  ].filter((p): p is [number, number] => p[0] != null);
  const wsum = parts.reduce((s, p) => s + p[1], 0);
  const overall = wsum ? Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / wsum) : null;
  const ageSec = (Date.parse(i.evaluatedAt) - Date.parse(i.signalAt)) / 1000;

  let decision: GateDecision;
  // Hard risk rules first (only on known data — unknown is never treated as bad).
  if (i.riskScore != null && i.riskScore > c.maxRisk) { decision = "REJECT"; reasons.push(`risiko token ${i.riskScore} > ${c.maxRisk}`); }
  else if (i.liquidityUsd != null && i.liquidityUsd < c.minLiquidityUsd) { decision = "REJECT"; reasons.push(`likuiditas < $${c.minLiquidityUsd}`); }
  else if (i.copyable === "no") { decision = "REJECT"; reasons.push("eksekusi tidak layak (biaya/pergerakan harga)"); }
  else if (missing.length >= 2 || (i.walletTrades ?? 0) < 1) { decision = "INSUFFICIENT_DATA"; reasons.push(`data kurang: ${missing.join(", ") || "sampel wallet"}`); }
  else if (ageSec > c.maxSignalAgeSec) { decision = "WATCH"; reasons.push("sinyal sudah kedaluwarsa"); }
  else if (i.entryStatus === "LATE" || (i.delaySec != null && i.delaySec > c.maxDelaySec)) { decision = "WATCH"; reasons.push("sinyal terlambat"); }
  else if ((i.walletTrades ?? 0) < c.minWalletTrades || (i.walletConfidence ?? 0) < c.minWalletConfidence) { decision = "WATCH"; reasons.push(`sampel wallet kecil (${i.walletTrades ?? 0} trade, confidence ${i.walletConfidence ?? 0})`); }
  else if (missing.length) { decision = "WATCH"; reasons.push(`data belum lengkap: ${missing.join(", ")}`); }
  else if (overall != null && overall >= c.acceptScore) { decision = "ACCEPT"; reasons.push(`skor gabungan ${overall} ≥ ${c.acceptScore} — hanya untuk paper/simulasi`); }
  else { decision = "WATCH"; reasons.push(`skor gabungan ${overall ?? "—"} < ${c.acceptScore}`); }

  return {
    decision,
    alpha_score: i.walletScore, early_entry_score: early, relationship_score: i.relationshipScore,
    token_risk_score: i.riskScore, execution_score: execution,
    confidence_score: i.walletConfidence, data_quality: dataQuality, overall_score: overall,
    reasons, algorithm_version: GATE_VERSION, evaluated_at: i.evaluatedAt,
  };
}
