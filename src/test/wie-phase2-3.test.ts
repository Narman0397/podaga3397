import { describe, it, expect } from "vitest";
import { computeOutcomes, type RawEvent } from "@/lib/wallet-intelligence/outcomes";
import { scoreWalletV2, tradeConfidence, type ClosedOutcome } from "@/lib/wallet-intelligence/scoring-v2";
import { runOutcomeEngine, type OutcomeDeps } from "@/lib/wallet-intelligence/outcomes";
import { runScoringV2, type ScoreDeps } from "@/lib/wallet-intelligence/scoring-v2";

const W = "WaLLet1111111111111111111111111111111111111";
const M1 = "Mint1111111111111111111111111111111111pump";
const M2 = "Mint2222222222222222222222222222222222pump";
const T0 = "2024-01-01T00:00:00.000Z";
const T1 = "2024-01-01T01:00:00.000Z";
const T2 = "2024-01-01T02:00:00.000Z";

function ev(mint: string, activity: "buy" | "sell", sol: number, block_time: string): RawEvent {
  return { wallet: W, mint, activity, sol_amount: sol, block_time, parse_status: "ok" };
}

// ─── Phase 2: computeOutcomes ───────────────────────────────
describe("computeOutcomes", () => {
  it("produces a closed outcome with correct roi and hold_sec", () => {
    const events: RawEvent[] = [ev(M1, "buy", 1.0, T0), ev(M1, "sell", 1.5, T1)];
    const outcomes = computeOutcomes(W, events);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      wallet: W,
      mint: M1,
      buy_count: 1,
      sell_count: 1,
      sol_spent: 1.0,
      sol_received: 1.5,
      is_closed: true,
    });
    expect(outcomes[0]!.roi).toBeCloseTo(1.5);
    expect(outcomes[0]!.hold_sec).toBe(3600);
  });

  it("marks open position when no sells", () => {
    const events: RawEvent[] = [ev(M1, "buy", 0.5, T0)];
    const outcomes = computeOutcomes(W, events);
    expect(outcomes[0]).toMatchObject({ is_closed: false, roi: null, hold_sec: null });
  });

  it("skips failed_tx events", () => {
    const events: RawEvent[] = [
      { ...ev(M1, "buy", 1.0, T0), parse_status: "failed_tx" },
      ev(M1, "sell", 1.5, T1),
    ];
    // No buy → no outcome for M1
    expect(computeOutcomes(W, events)).toHaveLength(0);
  });

  it("handles multiple mints independently", () => {
    const events: RawEvent[] = [
      ev(M1, "buy", 1.0, T0),
      ev(M1, "sell", 2.0, T1),
      ev(M2, "buy", 0.5, T0),
    ];
    const out = computeOutcomes(W, events);
    expect(out).toHaveLength(2);
    const m1 = out.find((o) => o.mint === M1)!;
    const m2 = out.find((o) => o.mint === M2)!;
    expect(m1.is_closed).toBe(true);
    expect(m2.is_closed).toBe(false);
  });

  it("ignores sol_transfer and token_transfer activities", () => {
    const events: RawEvent[] = [
      { wallet: W, mint: M1, activity: "sol_transfer", sol_amount: 5.0, block_time: T0, parse_status: "ok" },
      { wallet: W, mint: M1, activity: "token_transfer", sol_amount: 1.0, block_time: T1, parse_status: "ok" },
    ];
    expect(computeOutcomes(W, events)).toHaveLength(0);
  });

  it("aggregates multiple buys and sells", () => {
    const events: RawEvent[] = [
      ev(M1, "buy", 1.0, T0),
      ev(M1, "buy", 0.5, T1),
      ev(M1, "sell", 2.0, T2),
    ];
    const out = computeOutcomes(W, events);
    expect(out[0]).toMatchObject({ buy_count: 2, sell_count: 1, sol_spent: 1.5, sol_received: 2.0 });
    expect(out[0]!.roi).toBeCloseTo(2.0 / 1.5, 2);
  });
});

// ─── Phase 2: runOutcomeEngine (adapter injection) ───────────
describe("runOutcomeEngine adapter", () => {
  it("calls fetchEvents and upsertOutcomes; accumulates counters", async () => {
    const stored: unknown[] = [];
    const deps: OutcomeDeps = {
      fetchEvents: async () => [ev(M1, "buy", 1.0, T0), ev(M1, "sell", 1.5, T1)],
      upsertOutcomes: async (outcomes) => { stored.push(...outcomes); return outcomes.length; },
    };
    const c = await runOutcomeEngine([W], deps);
    expect(c.events_seen).toBe(2);
    expect(c.outcomes_written).toBe(1);
    expect(stored).toHaveLength(1);
  });

  it("increments error_count on adapter failure without aborting", async () => {
    const deps: OutcomeDeps = {
      fetchEvents: async () => { throw new Error("network"); },
      upsertOutcomes: async () => 0,
    };
    const c = await runOutcomeEngine([W, "Other1111111111111111111111111111111111111"], deps);
    expect(c.error_count).toBe(2);
    expect(c.wallets).toBe(2);
  });
});

// ─── Phase 3: tradeConfidence ────────────────────────────────
describe("tradeConfidence", () => {
  it("returns 0 for 0 trades", () => expect(tradeConfidence(0)).toBe(0));
  it("returns >0 for 1 trade", () => expect(tradeConfidence(1)).toBeGreaterThan(0));
  it("reaches ~80+ at 10 trades", () => expect(tradeConfidence(10)).toBeGreaterThanOrEqual(70));
  it("caps below 100", () => expect(tradeConfidence(1000)).toBeLessThan(100));
  it("is monotonically increasing", () => {
    for (let i = 1; i <= 20; i++) expect(tradeConfidence(i)).toBeGreaterThanOrEqual(tradeConfidence(i - 1));
  });
});

// ─── Phase 3: scoreWalletV2 ──────────────────────────────────
function outcome(roi: number, hold_sec: number): ClosedOutcome {
  return { roi, hold_sec, sol_spent: 1.0, computed_at: new Date().toISOString() };
}

describe("scoreWalletV2", () => {
  it("returns zero-score for empty outcomes", () => {
    const p = scoreWalletV2([]);
    expect(p).toMatchObject({ score: 0, confidence: 0, cls: "neutral", tokens_closed: 0 });
  });

  it("classifies alpha whale: high win-rate + high roi + 3+ trades", () => {
    const outcomes = [outcome(3.0, 3600), outcome(2.5, 1800), outcome(1.8, 7200)];
    const p = scoreWalletV2(outcomes);
    expect(p.cls).toBe("alpha");
    expect(p.score).toBeGreaterThan(0);
    expect(p.win_rate).toBe(100);
  });

  it("classifies churner: fast holds + low roi + 3+ trades", () => {
    const outcomes = [outcome(0.95, 60), outcome(0.9, 45), outcome(1.02, 90)];
    const p = scoreWalletV2(outcomes);
    expect(p.cls).toBe("churner");
    expect(p.score).toBeLessThan(50);
  });

  it("stays neutral with fewer than 3 trades regardless of win-rate", () => {
    const p = scoreWalletV2([outcome(5.0, 3600), outcome(4.0, 1800)]);
    expect(p.cls).toBe("neutral");
  });

  it("score is lower for same win-rate with low confidence (few trades)", () => {
    const few = scoreWalletV2([outcome(2.0, 1800)]);
    const many = scoreWalletV2(Array.from({ length: 20 }, () => outcome(2.0, 1800)));
    expect(many.score).toBeGreaterThan(few.score);
  });

  it("confidence and score are in valid ranges", () => {
    const trades = Array.from({ length: 10 }, (_, i) => outcome(i % 2 === 0 ? 1.5 : 0.8, 3600));
    const p = scoreWalletV2(trades);
    expect(p.confidence).toBeGreaterThanOrEqual(0);
    expect(p.confidence).toBeLessThanOrEqual(100);
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.score).toBeLessThanOrEqual(100);
  });
});

// ─── Phase 3: runScoringV2 adapter ──────────────────────────
describe("runScoringV2 adapter", () => {
  it("scores wallets with outcomes; skips wallets with no outcomes", async () => {
    const history: { wallet: string; perf: ClosedOutcome[] }[] = [];
    const tagUpdates: string[] = [];
    const deps: ScoreDeps = {
      fetchClosedOutcomes: async (wallet) =>
        wallet === W ? [outcome(2.0, 3600), outcome(1.5, 1800), outcome(1.8, 7200)] : [],
      saveScoreHistory: async (wallet, perf) => { history.push({ wallet, perf: perf as never }); return true; },
      updateWalletTagPerf: async (wallet) => { tagUpdates.push(wallet); },
    };
    const r = await runScoringV2([W, "Other1111111111111111111111111111111111111"], deps);
    expect(r.scored).toBe(1);
    expect(r.skipped).toBe(1);
    expect(history).toHaveLength(1);
    expect(tagUpdates).toContain(W);
  });
});
