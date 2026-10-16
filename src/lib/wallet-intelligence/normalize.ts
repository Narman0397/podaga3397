import { NORMALIZER_VERSION, type RawEnhancedTx, type WalletEvent } from "./types";

const LAMPORTS = 1e9;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;

export interface NormalizeResult {
  events: WalletEvent[];
  skipped: { reason: string; signature: string | null }[];
}

/**
 * Turns Helius enhanced transactions into per-wallet events.
 * - Identity = (signature, wallet, event_index): re-running yields identical keys (idempotent).
 * - Missing timestamp/slot stay null and mark the event "partial"; nothing is guessed.
 * - price_sol is only set for a swap with exactly one token leg and a non-zero SOL leg.
 */
export function normalizeWalletTxs(
  wallet: string,
  txs: RawEnhancedTx[],
  source = "helius-enhanced",
): NormalizeResult {
  const events: WalletEvent[] = [];
  const skipped: NormalizeResult["skipped"] = [];
  const seen = new Set<string>();
  for (const tx of txs) {
    const sig = typeof tx?.signature === "string" ? tx.signature : null;
    if (!sig || !SIG_RE.test(sig)) {
      skipped.push({ reason: "invalid_signature", signature: sig });
      continue;
    }
    if (seen.has(sig)) {
      skipped.push({ reason: "duplicate_in_batch", signature: sig });
      continue;
    }
    seen.add(sig);

    const ts = typeof tx.timestamp === "number" && tx.timestamp > 0 ? tx.timestamp : null;
    const slot = typeof tx.slot === "number" && tx.slot > 0 ? tx.slot : null;
    const failed = tx.transactionError != null;
    const type = tx.type ?? null;
    const isSwap = type === "SWAP";

    let lamports = 0,
      touchedSol = false;
    for (const n of tx.nativeTransfers ?? []) {
      if (typeof n?.amount !== "number") continue;
      if (n.toUserAccount === wallet) {
        lamports += n.amount;
        touchedSol = true;
      }
      if (n.fromUserAccount === wallet) {
        lamports -= n.amount;
        touchedSol = true;
      }
    }
    const sol = touchedSol ? lamports / LAMPORTS : null;

    const legs = (tx.tokenTransfers ?? []).filter(
      (t) => t?.mint && (t.toUserAccount === wallet || t.fromUserAccount === wallet),
    );
    const base = {
      wallet,
      signature: sig,
      slot,
      block_time: ts ? new Date(ts * 1000).toISOString() : null,
      source,
      parse_status: failed ? ("failed_tx" as const) : ("ok" as const),
      completeness: ts && slot ? ("full" as const) : ("partial" as const),
      raw_ref: { type, dex: tx.source ?? null },
      normalizer_version: NORMALIZER_VERSION,
    };

    if (!legs.length) {
      if (sol === null) {
        skipped.push({ reason: "wallet_not_involved", signature: sig });
        continue;
      }
      events.push({
        ...base,
        event_index: 0,
        activity: "sol_transfer",
        mint: null,
        direction: sol >= 0 ? "in" : "out",
        token_amount: null,
        sol_amount: Math.abs(sol),
        price_sol: null,
      });
      continue;
    }
    legs.forEach((t, i) => {
      const dir = t.toUserAccount === wallet ? ("in" as const) : ("out" as const);
      const amt = typeof t.tokenAmount === "number" && t.tokenAmount > 0 ? t.tokenAmount : null;
      const solAbs = sol === null ? null : Math.abs(sol);
      const price = isSwap && !failed && legs.length === 1 && amt && solAbs ? solAbs / amt : null;
      events.push({
        ...base,
        event_index: i,
        activity: isSwap ? (dir === "in" ? "buy" : "sell") : "token_transfer",
        mint: t.mint!,
        direction: dir,
        token_amount: amt,
        sol_amount: legs.length === 1 ? solAbs : null,
        price_sol: price,
      });
    });
  }
  return { events, skipped };
}

export const eventKey = (e: Pick<WalletEvent, "signature" | "wallet" | "event_index">) =>
  `${e.signature}:${e.wallet}:${e.event_index}`;
