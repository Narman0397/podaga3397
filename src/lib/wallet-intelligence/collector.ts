import { normalizeWalletTxs } from "./normalize";
import { emptyCounters, sanitizeError } from "./jobs";
import type { JobCounters, RawEnhancedTx, WalletEvent } from "./types";

export interface CollectState { wallet: string; newest_signature: string | null; newest_block_time: string | null; events_count: number }

/** Storage + source adapters so the collector is testable without network or database. */
export interface CollectorDeps {
  /** Newest-first page of txs newer than `until` (exclusive). Return null when the source failed. */
  fetchTxs: (wallet: string, until: string | null, limit: number) => Promise<RawEnhancedTx[] | null>;
  /** Insert events, ignoring ones whose identity already exists. Returns how many were new. */
  insertEvents: (events: WalletEvent[]) => Promise<number>;
  saveState: (s: CollectState & { possible_gap: boolean; last_error: string | null }) => Promise<void>;
}

export const COLLECT_LIMITS = { walletsPerRun: 10, txPerWallet: 100 };

/** Incremental, idempotent collection for a batch of wallets. One wallet's failure never aborts the batch. */
export async function collectWallets(states: CollectState[], deps: CollectorDeps, limits = COLLECT_LIMITS): Promise<JobCounters & { wallets: number }> {
  const c = emptyCounters();
  let wallets = 0;
  for (const s of states.slice(0, limits.walletsPerRun)) {
    wallets++;
    try {
      const txs = await deps.fetchTxs(s.wallet, s.newest_signature, limits.txPerWallet);
      if (txs === null) { c.error_count++; await deps.saveState({ ...s, possible_gap: false, last_error: "source_unavailable" }); continue; }
      const { events, skipped } = normalizeWalletTxs(s.wallet, txs);
      c.records_seen += txs.length;
      c.records_skipped += skipped.length;
      const inserted = events.length ? await deps.insertEvents(events) : 0;
      c.records_inserted += inserted;
      c.records_skipped += events.length - inserted;
      const newest = txs.find((t) => typeof t.signature === "string");
      const newestTs = newest?.timestamp ? new Date(newest.timestamp * 1000).toISOString() : s.newest_block_time;
      await deps.saveState({
        wallet: s.wallet,
        newest_signature: newest?.signature ?? s.newest_signature,
        newest_block_time: newestTs,
        events_count: s.events_count + inserted,
        // A full page means older txs between this page and the previous checkpoint may be missing.
        possible_gap: txs.length >= limits.txPerWallet,
        last_error: null,
      });
    } catch (e) {
      c.error_count++;
      await deps.saveState({ ...s, possible_gap: false, last_error: sanitizeError(e) }).catch(() => {});
    }
  }
  return { ...c, wallets };
}
