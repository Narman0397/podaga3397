import { describe, it, expect } from "vitest";
import { goldenSetup, type EdgeIntel } from "@/lib/edge";
const base: EdgeIntel = { cabalWallets: 1, watchWallets: 1, rugger: false, devDump: false, coordinated: true, earlyTagged: 2, exits: 0, fresh: 1, mode: "bundle", alpha: 0, churner: 0 };
describe("goldenSetup", () => {
  it("passes full setup at edge 70", () => expect(goldenSetup(base, 70).ok).toBe(true));
  it("rejects edge below 70", () => expect(goldenSetup(base, 69).ok).toBe(false));
  it("rejects any cluster exit", () => expect(goldenSetup({ ...base, exits: 2 }, 90).ok).toBe(false));
  it("rejects dev dump", () => expect(goldenSetup({ ...base, devDump: true }, 90).ok).toBe(false));
  it("rejects without verified cabal", () => expect(goldenSetup({ ...base, cabalWallets: 0 }, 90).ok).toBe(false));
  it("rejects without active inflow", () => expect(goldenSetup({ ...base, fresh: 0 }, 90).ok).toBe(false));
});

import { serverIntel } from "@/lib/edge";
describe("server Golden Setup intel", () => {
  const M = "mint1", now = 1_000_000_000_000, s = now / 1000;
  const tags = new Map([["A", "cabal"], ["B", "watch"]]);
  it("fresh coordinated cabal buys pass the gate", () => {
    const i = serverIntel(M, [{ timestamp: s - 60, tokenTransfers: [{ toUserAccount: "A", mint: M }, { toUserAccount: "B", mint: M }] }], tags, 1, 1, 10, now);
    expect(goldenSetup(i, 80).ok).toBe(true);
  });
  it("a tagged wallet selling within 15 min blocks the buy", () => {
    const i = serverIntel(M, [{ timestamp: s - 60, tokenTransfers: [{ toUserAccount: "A", mint: M }, { toUserAccount: "B", mint: M }, { fromUserAccount: "A", mint: M }] }], tags, 1, 1, 10, now);
    expect(goldenSetup(i, 80).ok).toBe(false);
  });
  it("stale buys older than 15 min fail Active Inflow", () => {
    const i = serverIntel(M, [{ timestamp: s - 3600, tokenTransfers: [{ toUserAccount: "A", mint: M }, { toUserAccount: "B", mint: M }] }], tags, 1, 1, 10, now);
    expect(goldenSetup(i, 80).fails).toContain("Tanpa Active Inflow");
  });
});
