// WIE V2.1 shared types. Unknown values are `null`, never 0.

export const NORMALIZER_VERSION = "wie-norm-1.2.0";

/** Minimal subset of a Helius enhanced transaction that the normalizer reads. */
export interface RawEnhancedTx {
  signature?: string | null;
  slot?: number | null;
  timestamp?: number | null;
  type?: string | null;
  source?: string | null;
  transactionError?: unknown;
  tokenTransfers?:
    | {
        fromUserAccount?: string | null;
        toUserAccount?: string | null;
        mint?: string | null;
        tokenAmount?: number | null;
      }[]
    | null;
  nativeTransfers?:
    | { fromUserAccount?: string | null; toUserAccount?: string | null; amount?: number | null }[]
    | null;
}

export type ParseStatus = "ok" | "failed_tx";
export type Completeness = "full" | "partial";

export interface WalletEvent {
  wallet: string;
  signature: string;
  event_index: number;
  slot: number | null;
  block_time: string | null;
  activity: string;
  mint: string | null;
  direction: "in" | "out" | null;
  token_amount: number | null;
  sol_amount: number | null;
  price_sol: number | null;
  source: string;
  parse_status: ParseStatus;
  completeness: Completeness;
  raw_ref: { type: string | null; dex: string | null; counterparty?: string | null };
  normalizer_version: string;
}

export type JobStatus = "running" | "success" | "failed" | "skipped";

export interface JobCounters {
  records_seen: number;
  records_inserted: number;
  records_updated: number;
  records_skipped: number;
  error_count: number;
}
