import { describe, it, expect } from "vitest";
import { classifyWallet } from "@/lib/wallet-inspect";

const perf = (cls: "alpha" | "churner" | "neutral") => ({ winRate: 50, avgRoi: 1, holdSec: 60, tokens: 10, cls, at: 0 });

describe("classifyWallet", () => {
  it("skips exchange wallets", () => expect(classifyWallet({ subs: 9, bundleScore: 90, perf: null, exchange: "Binance" }).tag).toBeNull());
  it("tags large tight bundles as rugger", () => expect(classifyWallet({ subs: 5, bundleScore: 71, perf: null, exchange: null }).tag).toBe("rugger"));
  it("tags 3+ subs with bundle >=60 as cabal", () => expect(classifyWallet({ subs: 3, bundleScore: 60, perf: null, exchange: null }).tag).toBe("cabal"));
  it("tags alpha performers as cabal", () => expect(classifyWallet({ subs: 0, bundleScore: 0, perf: perf("alpha"), exchange: null }).tag).toBe("cabal"));
  it("tags 2 subs as watch", () => expect(classifyWallet({ subs: 2, bundleScore: 10, perf: null, exchange: null }).tag).toBe("watch"));
  it("ignores lone wallets", () => expect(classifyWallet({ subs: 1, bundleScore: 0, perf: null, exchange: null }).tag).toBeNull());
  it("writes an auto note", () => expect(classifyWallet({ subs: 2, bundleScore: 10, perf: null, exchange: null }).note.startsWith("Auto:")).toBe(true));
});
