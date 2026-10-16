import { describe, expect, it } from "vitest";
import { getState, resetState, setState, type MemoryEntry } from "@/lib/store";

const wallet: MemoryEntry = { address: "retention-wallet", tag: "watch", note: "Manual", seen: 1, at: 1 };

describe("permanent wallet Memory", () => {
  it("retains stored wallets when an update omits or clears them", () => {
    setState(() => ({ memory: [wallet] }));
    setState(() => ({ memory: [] }));
    expect(getState().memory.find((m) => m.address === wallet.address)).toEqual(wallet);
    setState(() => ({ memory: [{ ...wallet, address: "new-retention-wallet" }] }));
    expect(getState().memory.some((m) => m.address === wallet.address)).toBe(true);
  });

  it("preserves wallet Memory during application reset", () => {
    setState(() => ({ memory: [wallet] }));
    resetState();
    expect(getState().memory.find((m) => m.address === wallet.address)).toEqual(wallet);
  });

  it("updates existing wallet details without duplicating or losing the wallet", () => {
    setState(() => ({ memory: [wallet] }));
    setState(() => ({ memory: [{ ...wallet, tag: "cabal", note: "Updated", seen: 2 }] }));
    expect(getState().memory.filter((m) => m.address === wallet.address)).toEqual([
      { ...wallet, tag: "cabal", note: "Updated", seen: 2 },
    ]);
  });
});