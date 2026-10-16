// WIE V2.1 Phase 3 — Alpha Scoring v2 (pure, injected adapters).
// Replaces classifyPerf-from-last-10-tokens with outcome-based scoring:
// confidence-weighted, versioned, stores history.

export const SCORE_VERSION = "wie-score-2.0.0";

/** A closed trade outcome (from wallet_outcomes where is_closed = true). */
export interface ClosedOutcome {
  roi: number;         // e.g. 1.45 = 45% profit
  hold_sec: number;
  sol_spent: number;
  computed_at: string;
}

export type PerfClass = "alpha" | "churner" | "neutral";

export interface ScoredPerf {
  win_rate: number;      // 0-100 %
  avg_roi: number;       // multiple
  hold_sec: number;      // median seconds
  tokens_closed: number;
  confidence: number;    // 0-100; rises with trade count
  score: number;         // 0-100 wallet quality score
  cls: PerfClass;
  score_version: string;
}

/**
 * Confidence: 0 for 0 trades, 50 at 5 trades, ~80 at 10, caps at 95.
 * Formula: 95 * (1 - e^(-n/8)) — smooth sigmoid-like curve.
 */
export function tradeConfidence(n: number): number {
  if (n <= 0) return 0;
  return Math.round(Math.min(95, 95 * (1 - Math.exp(-n / 8))));
}

/**
 * Score a wallet from its closed outcomes.
 * Minimum 1 closed trade; below 3 trades confidence is very low.
 */
export function scoreWalletV2(outcomes: ClosedOutcome[]): ScoredPerf {
  const n = outcomes.length;
  if (n === 0) {
    return { win_rate: 0, avg_roi: 0, hold_sec: 0, tokens_closed: 0, confidence: 0, score: 0, cls: "neutral", score_version: SCORE_VERSION };
  }

  // Sort by recency (most recent first); weight recent trades 2× in ROI average.
  const sorted = [...outcomes].sort((a, b) => Date.parse(b.computed_at) - Date.parse(a.computed_at));
  const wins = sorted.filter((o) => o.roi > 1).length;
  const win_rate = Math.round((wins / n) * 100);

  // Weighted avg_roi: recent trades (first half) get weight 2, older get weight 1.
  const half = Math.ceil(n / 2);
  let wSum = 0, wTotal = 0;
  sorted.forEach((o, i) => {
    const w = i < half ? 2 : 1;
    wSum += o.roi * w;
    wTotal += w;
  });
  const avg_roi = +(wSum / wTotal).toFixed(3);

  // Median hold
  const holds = sorted.map((o) => o.hold_sec).sort((a, b) => a - b);
  const hold_sec = holds[Math.floor(n / 2)] ?? 0;

  const confidence = tradeConfidence(n);

  // Classification (requires ≥3 trades for alpha/churner; else neutral)
  const cls: PerfClass =
    n >= 3 && win_rate >= 60 && avg_roi >= 1.5
      ? "alpha"
      : n >= 3 && hold_sec < 180 && avg_roi < 1.1
        ? "churner"
        : "neutral";

  // Score: base 20 + win-rate up to 40 + ROI bonus up to 30 + confidence discount
  const roiBonus = Math.min(30, Math.max(0, (avg_roi - 1) * 30));
  const winBonus = Math.min(40, win_rate * 0.4);
  const clsAdj = cls === "alpha" ? 10 : cls === "churner" ? -20 : 0;
  const rawScore = 20 + winBonus + roiBonus + clsAdj;
  // Scale by confidence so low-sample wallets can't reach a high score.
  const score = Math.max(0, Math.min(100, Math.round((rawScore * confidence) / 100)));

  return { win_rate, avg_roi, hold_sec, tokens_closed: n, confidence, score, cls, score_version: SCORE_VERSION };
}

export interface ScoreDeps {
  /** Fetch closed outcomes for a wallet; at most `limit` most recent. */
  fetchClosedOutcomes: (wallet: string, limit: number) => Promise<ClosedOutcome[]>;
  /** Persist a scored perf snapshot; returns true on success. */
  saveScoreHistory: (wallet: string, perf: ScoredPerf) => Promise<boolean>;
  /** Update perf on wallet_tags for all users that tagged this wallet. */
  updateWalletTagPerf: (wallet: string, perf: ScoredPerf) => Promise<void>;
}

export interface ScoreCounters {
  wallets: number;
  scored: number;
  skipped: number;
  error_count: number;
}

export const SCORE_OUTCOME_LIMIT = 50; // look at last 50 closed trades per wallet

/** Score a batch of wallets; persist history + update wallet_tags.perf. */
export async function runScoringV2(
  wallets: string[],
  deps: ScoreDeps,
): Promise<ScoreCounters> {
  const c: ScoreCounters = { wallets: wallets.length, scored: 0, skipped: 0, error_count: 0 };
  for (const wallet of wallets) {
    try {
      const outcomes = await deps.fetchClosedOutcomes(wallet, SCORE_OUTCOME_LIMIT);
      if (!outcomes.length) { c.skipped++; continue; }
      const perf = scoreWalletV2(outcomes);
      await Promise.all([
        deps.saveScoreHistory(wallet, perf),
        deps.updateWalletTagPerf(wallet, perf),
      ]);
      c.scored++;
    } catch {
      c.error_count++;
    }
  }
  return c;
}
