import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalletTag, WALLET_TAG_LABELS } from "@/components/WalletTag";
import type { MemoryEntry } from "@/lib/store";

afterEach(cleanup);

describe("wallet display labels", () => {
  it.each([
    ["watch", "Pola Bundler, belum dinilai"],
    ["cabal", "Kandidat Cabal"],
    ["rugger", "Serial Rugger"],
  ] as const)("displays %s without changing its stored value", (tag, label) => {
    const entry: MemoryEntry = { address: "wallet", tag, note: "", seen: 3, at: 0 };
    render(<WalletTag entry={entry} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Manual · 3 kemunculan")).toBeInTheDocument();
    expect(entry.tag).toBe(tag);
    expect(WALLET_TAG_LABELS[tag]).toBe(label);
  });

  it("shows automatic source and the stored occurrence count", () => {
    render(<WalletTag entry={{ address: "wallet", tag: "watch", note: "Auto: Pump.fun Bundler", seen: 12, at: 0 }} />);
    expect(screen.getByText("Otomatis · 12 kemunculan")).toBeInTheDocument();
  });
});