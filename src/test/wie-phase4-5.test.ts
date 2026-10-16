import { describe, it, expect } from "vitest";
import { evaluateEntry, tokenRisk, estimateExecution, dueHorizons, attribute, excursions } from "@/lib/wallet-intelligence/signals";

const t = (s: number) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString();

describe("Phase 4 early entry", () => {
  it("missing signal price → INSUFFICIENT_DATA", () => {
    expect(evaluateEntry({ sourceTxAt: t(0), signalAt: t(60), sourcePriceSol: 1, signalPriceSol: null }).status).toBe("INSUFFICIENT_DATA");
  });
  it("delay over 15 minutes → LATE", () => {
    expect(evaluateEntry({ sourceTxAt: t(0), signalAt: t(16 * 60), sourcePriceSol: 1, signalPriceSol: 1 }).status).toBe("LATE");
  });
  it("price up more than 50% → LATE", () => {
    const r = evaluateEntry({ sourceTxAt: t(0), signalAt: t(60), sourcePriceSol: 1, signalPriceSol: 1.6 });
    expect(r.status).toBe("LATE");
    expect(r.movePct).toBe(60);
  });
  it("fast and close to source price → EARLY", () => {
    expect(evaluateEntry({ sourceTxAt: t(0), signalAt: t(120), sourcePriceSol: 1, signalPriceSol: 1.1 }).status).toBe("EARLY");
  });
  it("horizon past tolerance is missed, not backfilled", () => {
    const d = dueHorizons(t(0), {}, Date.parse(t(3600 + 31 * 60)));
    expect(d.find((x) => x.key === "1h")?.missed).toBe(true);
    expect(d.find((x) => x.key === "24h")).toBeUndefined();
  });
  it("excursions from horizon returns", () => {
    expect(excursions(1, [{ price: 1.2, ret_pct: 20, at: "" }, { price: 0.9, ret_pct: -10, at: "" }])).toEqual({ mfe: 20, mae: -10 });
  });
  it("attribution needs at least 5 evaluated signals", () => {
    const s = Array.from({ length: 4 }, () => ({ wallet: "A", status: "EARLY" as const, horizons: { "1h": { price: 1, ret_pct: 30, at: "" } }, costPct: 2 }));
    expect(attribute(s)[0]?.verdict).toBe("INSUFFICIENT_DATA");
  });
});

describe("Phase 5 risk + execution", () => {
  it("unknown inputs give null risk, not zero", () => {
    expect(tokenRisk({ liquidityUsd: null, volumeH24Usd: null, poolAgeMin: null }).risk).toBeNull();
  });
  it("liquidity under $5k adds 35 risk", () => {
    expect(tokenRisk({ liquidityUsd: 4000, volumeH24Usd: 1000, poolAgeMin: 600 }).risk).toBe(35);
  });
  it("unknown liquidity → copyable unknown", () => {
    expect(estimateExecution({ sizeSol: 0.2, liquidityUsd: null, solUsd: 150, entryMovePct: 0 }).copyable).toBe("unknown");
  });
  it("thin pool makes the trade not copyable", () => {
    // pool side = 1500/2/150 = 5 SOL; impact 0.2/5.2 ≈ 3.85% → round trip ≈ 8.2% + fees… use smaller pool
    expect(estimateExecution({ sizeSol: 1, liquidityUsd: 1500, solUsd: 150, entryMovePct: 0 }).copyable).toBe("no");
  });
});
