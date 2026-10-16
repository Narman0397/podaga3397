// WIE V2.1 Phase 2 — Outcome Engine (pure, injected adapters).
// Aggregates wallet_events per (wallet, mint) into a closed/open position outcome.

export const OUTCOME_VERSION = "wie-out-1.0.0";

export interface RawEvent {
  wallet: string;
  mint: string | null;
  activity: string; // "buy" | "sell" | "token_transfer" | "sol_transfer"
  sol_amount: number | null;
  block_time: string | null;
  parse_status: string;
}

export interface WalletOutcome {
  wallet: string;
  mint: string;
  first_buy_at: string | null;
  last_sell_at: string | null;
  buy_count: number;
  sell_count: number;
  sol_spent: number;
  sol_received: number;
  roi: number | null;
  hold_sec: number | null;
  is_closed: boolean;
  outcome_version: string;
  computed_at: string;
}

export interface OutcomeDeps {
  /** Fetch all buy/sell events for a wallet after `since` (exclusive), ordered by block_time ASC. */
  fetchEvents: (wallet: string, since: string | null) => Promise<RawEvent[]>;
  /** Upsert outcomes for a wallet; returns count inserted/updated. */
  upsertOutcomes: (outcomes: WalletOutcome[]) => Promise<number>;
}

export interface OutcomeCounters {
  wallets: number;
  events_seen: number;
  outcomes_written: number;
  error_count: number;
}

/** Compute position outcomes from a stream of buy/sell events for one wallet. */
export function computeOutcomes(wallet: string, events: RawEvent[]): WalletOutcome[] {
  const now = new Date().toISOString();
  // Group by mint; skip sol_transfer and events without mint
  const byMint = new Map<string, { buys: { sol: number; at: string }[]; sells: { sol: number; at: string }[] }>();
  for (const e of events) {
    if (!e.mint || e.parse_status === "failed_tx") continue;
    const act = e.activity;
    if (act !== "buy" && act !== "sell") continue;
    const sol = e.sol_amount;
    if (sol === null || sol <= 0) continue;
    const at = e.block_time ?? now;
    const slot = byMint.get(e.mint) ?? { buys: [], sells: [] };
    if (act === "buy") slot.buys.push({ sol, at });
    else slot.sells.push({ sol, at });
    byMint.set(e.mint, slot);
  }

  const outcomes: WalletOutcome[] = [];
  for (const [mint, { buys, sells }] of byMint) {
    if (!buys.length) continue; // ignore sell-only (entered before data window)
    const sol_spent = buys.reduce((a, b) => a + b.sol, 0);
    const sol_received = sells.reduce((a, s) => a + s.sol, 0);
    const is_closed = sells.length > 0;
    const first_buy_at = buys.map((b) => b.at).sort()[0] ?? null;
    const last_sell_at = is_closed ? sells.map((s) => s.at).sort().at(-1)! : null;
    const hold_sec =
      is_closed && first_buy_at && last_sell_at
        ? Math.max(0, Math.round((Date.parse(last_sell_at) - Date.parse(first_buy_at)) / 1000))
        : null;
    const roi = is_closed && sol_spent > 0 ? +(sol_received / sol_spent).toFixed(4) : null;
    outcomes.push({
      wallet,
      mint,
      first_buy_at,
      last_sell_at,
      buy_count: buys.length,
      sell_count: sells.length,
      sol_spent: +sol_spent.toFixed(6),
      sol_received: +sol_received.toFixed(6),
      roi,
      hold_sec,
      is_closed,
      outcome_version: OUTCOME_VERSION,
      computed_at: now,
    });
  }
  return outcomes;
}

/** Run outcome engine for a batch of wallets; processes each independently. */
export async function runOutcomeEngine(
  wallets: string[],
  deps: OutcomeDeps,
  since: string | null = null,
): Promise<OutcomeCounters> {
  const c: OutcomeCounters = { wallets: wallets.length, events_seen: 0, outcomes_written: 0, error_count: 0 };
  for (const wallet of wallets) {
    try {
      const events = await deps.fetchEvents(wallet, since);
      c.events_seen += events.length;
      if (!events.length) continue;
      const outcomes = computeOutcomes(wallet, events);
      if (!outcomes.length) continue;
      c.outcomes_written += await deps.upsertOutcomes(outcomes);
    } catch {
      c.error_count++;
    }
  }
  return c;
}
