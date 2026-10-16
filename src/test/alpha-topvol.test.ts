import { describe, it, expect } from "vitest";
import { isAlphaWhale, pickTopVolume } from "@/lib/edge";

describe("isAlphaWhale", () => {
  it("requires win-rate above 60%", () => {
    expect(isAlphaWhale({ winRate: 60, avgRoi: 2, tokens: 5 })).toBe(false);
    expect(isAlphaWhale({ winRate: 61, avgRoi: 2, tokens: 5 })).toBe(true);
  });
  it("requires positive ROI", () => expect(isAlphaWhale({ winRate: 80, avgRoi: 0.9, tokens: 5 })).toBe(false));
  it("requires at least 3 closed tokens", () => expect(isAlphaWhale({ winRate: 100, avgRoi: 3, tokens: 2 })).toBe(false));
});

describe("pickTopVolume", () => {
  const p = (a: string, v: number, l = 50_000, chainId = "solana") => ({ chainId, baseToken: { address: a }, volume: { h24: v }, liquidity: { usd: l } });
  it("sorts by 24h volume, dedupes mints, drops low liquidity and other chains, caps at n", () => {
    const out = pickTopVolume([p("A", 10), p("B", 30), p("A", 50), p("C", 99, 100), p("D", 999, 50_000, "bsc"), p("E", 20)], 15_000, 2);
    expect(out.map((x) => x.baseToken.address)).toEqual(["A", "B"]);
  });
});
