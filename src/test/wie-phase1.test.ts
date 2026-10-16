import { describe, it, expect } from "vitest";
import { normalizeWalletTxs, eventKey } from "@/lib/wallet-intelligence/normalize";
import { collectWallets, type CollectState } from "@/lib/wallet-intelligence/collector";
import { sanitizeError, finalStatus, emptyCounters, isStale } from "@/lib/wallet-intelligence/jobs";
import type { RawEnhancedTx, WalletEvent } from "@/lib/wallet-intelligence/types";

const W = "WaLLet1111111111111111111111111111111111111";
const MINT = "Mint11111111111111111111111111111111111pump";
const sig = (n: number) => `${"5".repeat(80)}${String(n).padStart(8, "1").replace(/0/g, "1")}`;
const buy = (n: number, ts: number | null = 1_700_000_000 + n): RawEnhancedTx => ({
  signature: sig(n),
  slot: ts ? 100 + n : null,
  timestamp: ts,
  type: "SWAP",
  source: "PUMP_FUN",
  tokenTransfers: [{ fromUserAccount: "pool", toUserAccount: W, mint: MINT, tokenAmount: 1000 }],
  nativeTransfers: [{ fromUserAccount: W, toUserAccount: "pool", amount: 0.5e9 }],
});

describe("WIE normalizer", () => {
  it("normalizes a valid swap with price estimate and full completeness", () => {
    const { events } = normalizeWalletTxs(W, [buy(1)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      activity: "buy",
      direction: "in",
      token_amount: 1000,
      sol_amount: 0.5,
      completeness: "full",
      parse_status: "ok",
    });
    expect(events[0]!.price_sol).toBeCloseTo(0.0005);
  });
  it("rejects invalid signatures and dedupes within a batch", () => {
    const r = normalizeWalletTxs(W, [buy(1), buy(1), { signature: "bad" }, {}]);
    expect(r.events).toHaveLength(1);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual([
      "duplicate_in_batch",
      "invalid_signature",
      "invalid_signature",
    ]);
  });
  it("keeps unknown values null instead of zero", () => {
    const { events } = normalizeWalletTxs(W, [
      {
        signature: sig(2),
        type: "TRANSFER",
        tokenTransfers: [{ toUserAccount: W, mint: MINT, tokenAmount: null }],
      },
    ]);
    expect(events[0]).toMatchObject({
      block_time: null,
      slot: null,
      token_amount: null,
      sol_amount: null,
      price_sol: null,
      completeness: "partial",
    });
  });
  it("marks failed transactions and never prices them", () => {
    const { events } = normalizeWalletTxs(W, [{ ...buy(3), transactionError: { err: 1 } }]);
    expect(events[0]).toMatchObject({ parse_status: "failed_tx", price_sol: null });
  });
  it("produces identical identities on re-run (idempotent keys)", () => {
    const a = normalizeWalletTxs(W, [buy(1), buy(2)]).events.map(eventKey);
    const b = normalizeWalletTxs(W, [buy(2), buy(1)]).events.map(eventKey);
    expect(new Set(a)).toEqual(new Set(b));
  });
});

function memoryDeps(pages: (RawEnhancedTx[] | null)[]) {
  const db = new Map<string, WalletEvent>();
  const states: CollectState[] = [];
  let call = 0;
  return {
    db,
    states,
    deps: {
      fetchTxs: async () => pages[Math.min(call++, pages.length - 1)] ?? null,
      insertEvents: async (ev: WalletEvent[]) => {
        let n = 0;
        for (const e of ev)
          if (!db.has(eventKey(e))) {
            db.set(eventKey(e), e);
            n++;
          }
        return n;
      },
      saveState: async (s: CollectState) => {
        states.push(s);
      },
    },
  };
}

describe("WIE collector", () => {
  const start: CollectState = {
    wallet: W,
    newest_signature: null,
    newest_block_time: null,
    events_count: 0,
  };
  it("retry / re-run does not duplicate records", async () => {
    const m = memoryDeps([[buy(2), buy(1)]]);
    const r1 = await collectWallets([start], m.deps);
    const r2 = await collectWallets([start], m.deps);
    expect(r1.records_inserted).toBe(2);
    expect(r2.records_inserted).toBe(0);
    expect(r2.records_skipped).toBe(2);
    expect(m.db.size).toBe(2);
  });
  it("advances the checkpoint to the newest signature", async () => {
    const m = memoryDeps([[buy(9), buy(8)]]);
    await collectWallets([start], m.deps);
    expect(m.states.at(-1)?.newest_signature).toBe(sig(9));
  });
  it("records a source failure without aborting other wallets", async () => {
    const m = memoryDeps([null, [buy(1)]]);
    const r = await collectWallets(
      [start, { ...start, wallet: "Other111111111111111111111111111111111111111" }],
      m.deps,
    );
    expect(r.error_count).toBe(1);
    expect(r.wallets).toBe(2);
  });
  it("respects the batch limit", async () => {
    const m = memoryDeps([[]]);
    const r = await collectWallets(
      Array.from({ length: 20 }, () => start),
      m.deps,
      { walletsPerRun: 3, txPerWallet: 100 },
    );
    expect(r.wallets).toBe(3);
  });
});

describe("WIE job helpers", () => {
  it("sanitizes keys, urls and bearer tokens", () => {
    const s = sanitizeError(
      new Error("fail https://api.helius.xyz/v0?api-key=SECRET123 Bearer abc.def"),
    );
    expect(s).not.toMatch(/SECRET123|abc\.def|helius\.xyz/);
  });
  it("derives final status", () => {
    expect(finalStatus(emptyCounters(), new Error("x"))).toBe("failed");
    expect(finalStatus({ ...emptyCounters(), records_seen: 5, error_count: 1 }, null)).toBe(
      "success",
    );
    expect(finalStatus({ ...emptyCounters(), error_count: 2 }, null)).toBe("failed");
  });
  it("flags stale runs", () => {
    expect(isStale(null, 1000)).toBe(true);
    expect(isStale(new Date(0).toISOString(), 1000, 5000)).toBe(true);
    expect(isStale(new Date(4500).toISOString(), 1000, 5000)).toBe(false);
  });
});
