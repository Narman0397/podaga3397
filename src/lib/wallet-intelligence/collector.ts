import { normalizeWalletTxs } from "./normalize";
import { emptyCounters, sanitizeError } from "./jobs";
import type { JobCounters, RawEnhancedTx, WalletEvent } from "./types";

export interface CollectState {
  wallet: string;
  newest_signature: string | null;
  newest_block_time: string | null;
  events_count: number;
  /** Older-page cursor while a gap is being backfilled (fetch txs before this signature). */
  backfill_before?: string | null;
  /** Top of the range being backfilled; becomes the checkpoint only once the range is complete. */
  pending_newest_signature?: string | null;
  pending_newest_block_time?: string | null;
  possible_gap?: boolean;
}

export type SavedState = CollectState & {
  possible_gap: boolean;
  last_error: string | null;
  history_complete?: boolean;
};

/** Storage + source adapters so the collector is testable without network or database. */
export interface CollectorDeps {
  /** Newest-first page of txs newer than `until` and older than `before` (both exclusive). Null = source failed. */
  fetchTxs: (
    wallet: string,
    until: string | null,
    limit: number,
    before?: string | null,
  ) => Promise<RawEnhancedTx[] | null>;
  /** Insert events, ignoring ones whose identity already exists. Returns how many were new. */
  insertEvents: (events: WalletEvent[]) => Promise<number>;
  saveState: (s: SavedState) => Promise<void>;
}

export const COLLECT_LIMITS = { walletsPerRun: 10, txPerWallet: 100, backfillPagesPerWallet: 3 };

const isoOf = (t?: RawEnhancedTx) => (t?.timestamp ? new Date(t.timestamp * 1000).toISOString() : null);
const sigs = (txs: RawEnhancedTx[]) => txs.filter((t) => typeof t.signature === "string");

/**
 * Incremental, idempotent, gap-safe collection. The checkpoint (newest_signature) only advances when the
 * whole range between it and the newest tx has been stored; full pages switch the wallet into backfill mode
 * that pages backwards (before=) until it reaches the old checkpoint. One wallet's failure never aborts the batch.
 */
export async function collectWallets(
  states: CollectState[],
  deps: CollectorDeps,
  limits = COLLECT_LIMITS,
): Promise<JobCounters & { wallets: number; gaps_closed: number }> {
  const c = emptyCounters();
  let wallets = 0, gaps_closed = 0;
  const pages = limits.backfillPagesPerWallet ?? 3;
  for (const s0 of states.slice(0, limits.walletsPerRun)) {
    wallets++;
    let s: CollectState = { ...s0 };
    try {
      for (let page = 0; page < pages; page++) {
        const backfilling = !!(s.pending_newest_signature || s.backfill_before);
        // Legacy gaps (pointer already advanced, pending == newest) walk back with no lower bound.
        const until = backfilling && s.pending_newest_signature === s.newest_signature ? null : s.newest_signature;
        const txs = await deps.fetchTxs(s.wallet, until, limits.txPerWallet, backfilling ? s.backfill_before ?? null : null);
        if (txs === null) {
          c.error_count++;
          // Source failed: keep checkpoint and cursor untouched.
          await deps.saveState({ ...s, possible_gap: backfilling || !!s.possible_gap, last_error: "source_unavailable" });
          break;
        }
        const { events, skipped } = normalizeWalletTxs(s.wallet, txs);
        c.records_seen += txs.length;
        c.records_skipped += skipped.length;
        const inserted = events.length ? await deps.insertEvents(events) : 0; // throws -> checkpoint not moved
        c.records_inserted += inserted;
        c.records_skipped += events.length - inserted;
        const withSig = sigs(txs);
        const full = txs.length >= limits.txPerWallet;
        const top = withSig[0], bottom = withSig[withSig.length - 1];

        if (!backfilling) {
          if (!full) {
            s = { ...s, newest_signature: top?.signature ?? s.newest_signature, newest_block_time: isoOf(top) ?? s.newest_block_time, events_count: s.events_count + inserted };
            await deps.saveState({ ...s, possible_gap: false, last_error: null});
            break;
          }
          // Full page: range below this page is not yet stored → hold checkpoint, start backfill.
          s = { ...s, events_count: s.events_count + inserted, pending_newest_signature: top?.signature ?? null, pending_newest_block_time: isoOf(top), backfill_before: bottom?.signature ?? null };
          await deps.saveState({ ...s, possible_gap: true, last_error: null });
          continue;
        }

        // Backfill mode.
        if (!full) {
          // Reached the old checkpoint (or start of history): range complete → advance checkpoint.
          gaps_closed++;
          s = {
            ...s, events_count: s.events_count + inserted,
            newest_signature: s.pending_newest_signature ?? top?.signature ?? s.newest_signature,
            newest_block_time: s.pending_newest_block_time ?? isoOf(top) ?? s.newest_block_time,
            pending_newest_signature: null, pending_newest_block_time: null, backfill_before: null,
          };
          await deps.saveState({ ...s, possible_gap: false, last_error: null, ...(s0.newest_signature == null || txs.length === 0 ? { history_complete: true } : {}) });
          break;
        }
        s = { ...s, events_count: s.events_count + inserted, backfill_before: bottom?.signature ?? s.backfill_before ?? null };
        await deps.saveState({ ...s, possible_gap: true, last_error: null });
      }
    } catch (e) {
      c.error_count++;
      await deps.saveState({ ...s0, possible_gap: !!(s0.possible_gap || s0.pending_newest_signature || s0.backfill_before), last_error: sanitizeError(e) }).catch(() => {});
    }
  }
  return { ...c, wallets, gaps_closed };
}
