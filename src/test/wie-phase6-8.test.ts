import { describe, it, expect } from "vitest";
import { buildRelations, neighbourhood, relationStatus, type GraphEvent } from "@/lib/wallet-intelligence/graph";
import { evaluateGate, type GateInput } from "@/lib/wallet-intelligence/gate";
import { runBacktest, metrics } from "@/lib/wallet-intelligence/backtest";

const t = (s: number) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString();
const A = "A".repeat(32), B = "B".repeat(32), C = "C".repeat(32);
const tr = (sig: string, w: string, cp: string): GraphEvent => ({ wallet: w, signature: sig, block_time: t(0), activity: "sol_transfer", mint: null, direction: "out", sol_amount: 1, counterparty: cp });

describe("Phase 6 wallet graph", () => {
  it("3 funding transfers → strong_evidence; 1 → observed", () => {
    const r = buildRelations([tr("s1", A, B), tr("s2", A, B), tr("s3", B, A), tr("s4", A, C)], new Set());
    expect(r.find((x) => x.wallet_b === B)!.status).toBe("strong_evidence");
    expect(r.find((x) => x.wallet_b === C)!.status).toBe("observed");
  });
  it("retried evidence does not double count", () => {
    expect(buildRelations([tr("s1", A, B), tr("s1", A, B)], new Set())[0]!.frequency).toBe(1);
  });
  it("exchange counterparty is rejected", () => {
    expect(buildRelations([tr("s1", A, B)], new Set(), (x) => (x === B ? "Binance" : null))[0]!.status).toBe("rejected");
  });
  it("co-entry alone never reaches strong_evidence", () => {
    expect(relationStatus("co_entry", 50, null).status).toBe("suspected");
  });
  it("co-entry only within 60s", () => {
    const buy = (w: string, s: number, sig: string): GraphEvent => ({ wallet: w, signature: sig, block_time: t(s), activity: "buy", mint: "M", direction: "in", sol_amount: 1, counterparty: null });
    expect(buildRelations([buy(A, 0, "x"), buy(B, 30, "y")], new Set([A, B]))).toHaveLength(1);
    expect(buildRelations([buy(A, 0, "x"), buy(B, 120, "y")], new Set([A, B]))).toHaveLength(0);
  });
  it("neighbourhood is bounded", () => {
    const rels = Array.from({ length: 200 }, (_, i) => ({ wallet_a: A, wallet_b: `w${i}`, confidence: i }));
    const g = neighbourhood(A, rels);
    expect(g.nodes.length).toBeLessThanOrEqual(60);
    expect(g.edges.length).toBeLessThanOrEqual(59);
  });
});

const base: GateInput = { walletScore: 80, walletConfidence: 70, walletTrades: 10, entryStatus: "EARLY", delaySec: 60, riskScore: 10, riskConfidence: 80, liquidityUsd: 50_000, copyable: "yes", relationshipScore: null, signalAt: t(0), evaluatedAt: t(60) };
describe("Phase 7 gate", () => {
  it("produces all four decisions", () => {
    expect(evaluateGate(base).decision).toBe("ACCEPT");
    expect(evaluateGate({ ...base, entryStatus: "LATE" }).decision).toBe("WATCH");
    expect(evaluateGate({ ...base, riskScore: 90 }).decision).toBe("REJECT");
    expect(evaluateGate({ ...base, walletScore: null, liquidityUsd: null, riskScore: null }).decision).toBe("INSUFFICIENT_DATA");
  });
  it("small wallet sample → WATCH, not ACCEPT", () => {
    expect(evaluateGate({ ...base, walletTrades: 2, walletConfidence: 20 }).decision).toBe("WATCH");
  });
  it("unknown liquidity is not treated as low liquidity", () => {
    expect(evaluateGate({ ...base, liquidityUsd: null }).decision).toBe("WATCH");
  });
  it("expired signal → WATCH", () => {
    expect(evaluateGate({ ...base, evaluatedAt: t(3600) }).decision).toBe("WATCH");
  });
  it("is versioned and explained", () => {
    const g = evaluateGate(base);
    expect(g.algorithm_version).toMatch(/^wie-gate-/);
    expect(g.reasons.length).toBeGreaterThan(0);
  });
});

describe("Phase 7 backtest", () => {
  it("metrics: positive, negative, empty", () => {
    expect(metrics([10, -5]).expectancy).toBe(2.5);
    expect(metrics([10, -5]).profitFactor).toBe(2);
    expect(metrics([]).winRate).toBeNull();
  });
  it("chronological split; unfinished horizons excluded; missing price = -100%", () => {
    const sig = Array.from({ length: 10 }, (_, i) => ({ signal_at: t(i), decision: "ACCEPT", ret_pct: i === 9 ? null : 10, finished: true, cost_pct: 0 }));
    sig.push({ signal_at: t(99), decision: "ACCEPT", ret_pct: 50, finished: false, cost_pct: 0 });
    const r = runBacktest(sig);
    expect(r.train.n).toBe(6);
    expect(r.test.n).toBe(4);
    expect(r.test.to).toBe(t(9));
    expect(r.test.expectancy).toBe(-17.5);
    expect(r.warnings.some((w) => w.includes("belum selesai"))).toBe(true);
  });
});
