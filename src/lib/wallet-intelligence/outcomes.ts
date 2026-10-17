// WIE V2.1 Phase 2 — Outcome Engine (pure, injected adapters).
// Aggregates wallet_events per (wallet, mint) into OPEN / PARTIAL / CLOSED / TRANSFER_ONLY positions.
// On-chain trade times (first_trade_at/last_trade_at) are kept separate from computed_at.

export const OUTCOME_VERSION = "wie-out-1.1.0";
/** A position is CLOSED once ≥ 99% of bought tokens were sold (remaining is dust). */
export const CLOSE_SOLD_SHARE = 0.99;

export type PositionStatus = "OPEN" | "PARTIAL" | "CLOSED" | "TRANSFER_ONLY";

export interface RawEvent {
  wallet: string;
  mint: string | null;
  activity: string; // "buy" | "sell" | "token_transfer" | "sol_transfer"
  sol_amount: number | null;
  token_amount?: number | null;
  direction?: string | null; // "in" | "out" for transfers
  block_time: string | null;
  parse_status: string;
}

export interface WalletOutcome {
  wallet: string;
  mint: string;
  first_buy_at: string | null;
  last_sell_at: string | null;
  first_trade_at: string | null;
  last_trade_at: string | null;
  buy_count: number;
  sell_count: number;
  transfer_in_count: number;
  transfer_out_count: number;
  sol_spent: number;
  sol_received: number;
  tokens_bought: number | null;
  tokens_sold: number | null;
  remaining_tokens: number | null;
  realized_sol: number | null;
  roi: number | null;
  hold_sec: number | null;
  position_status: PositionStatus;
  is_closed: boolean;
  outcome_version: string;
  computed_at: string;
}

export interface OutcomeDeps {
  fetchEvents: (wallet: string, since: string | null) => Promise<RawEvent[]>;
  upsertOutcomes: (outcomes: WalletOutcome[]) => Promise<number>;
}

export interface OutcomeCounters {
  wallets: number;
  events_seen: number;
  outcomes_written: number;
  error_count: number;
}

type Leg = { sol: number | null; tok: number | null; at: string | null };
const sum = (xs: (number | null)[]) => (xs.some((x) => x == null) ? null : xs.reduce<number>((a, b) => a + (b as number), 0));
const sorted = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort();
const r6 = (n: number | null) => (n == null ? null : +n.toFixed(6));

/** Compute position outcomes from a wallet's events. Unknown token amounts stay null (never guessed). */
export function computeOutcomes(wallet: string, events: RawEvent[], computedAt = new Date().toISOString()): WalletOutcome[] {
  const byMint = new Map<string, { buys: Leg[]; sells: Leg[]; tin: Leg[]; tout: Leg[] }>();
  for (const e of events) {
    if (!e.mint || e.parse_status === "failed_tx") continue;
    const slot = byMint.get(e.mint) ?? { buys: [], sells: [], tin: [], tout: [] };
    const leg: Leg = { sol: e.sol_amount != null ? Number(e.sol_amount) : null, tok: e.token_amount != null ? Math.abs(Number(e.token_amount)) : null, at: e.block_time };
    if (e.activity === "buy") { if (leg.sol == null || leg.sol <= 0) continue; slot.buys.push(leg); }
    else if (e.activity === "sell") { if (leg.sol == null || leg.sol <= 0) continue; slot.sells.push(leg); }
    else if (e.activity === "token_transfer") (e.direction === "out" ? slot.tout : slot.tin).push(leg);
    else continue;
    byMint.set(e.mint, slot);
  }

  const out: WalletOutcome[] = [];
  for (const [mint, { buys, sells, tin, tout }] of byMint) {
    const tradeTimes = sorted([...buys, ...sells].map((x) => x.at));
    const base = {
      wallet, mint, buy_count: buys.length, sell_count: sells.length,
      transfer_in_count: tin.length, transfer_out_count: tout.length,
      outcome_version: OUTCOME_VERSION, computed_at: computedAt,
    };
    if (!buys.length) {
      // Only transfers (or sells of tokens received by transfer): not a trade, isolated from PnL.
      if (!tin.length && !tout.length) continue; // sell-only, entered before data window
      out.push({
        ...base, first_buy_at: null, last_sell_at: null,
        first_trade_at: tradeTimes[0] ?? sorted([...tin, ...tout].map((x) => x.at))[0] ?? null,
        last_trade_at: tradeTimes.at(-1) ?? sorted([...tin, ...tout].map((x) => x.at)).at(-1) ?? null,
        sol_spent: 0, sol_received: +(sum(sells.map((s) => s.sol)) ?? 0).toFixed(6),
        tokens_bought: null, tokens_sold: r6(sum(sells.map((s) => s.tok))), remaining_tokens: null,
        realized_sol: null, roi: null, hold_sec: null, position_status: "TRANSFER_ONLY", is_closed: false,
      });
      continue;
    }
    const sol_spent = sum(buys.map((b) => b.sol)) ?? 0;
    const sol_received = sum(sells.map((s) => s.sol)) ?? 0;
    const bought = sum(buys.map((b) => b.tok));
    const sold = sells.length ? sum(sells.map((s) => s.tok)) : 0;
    const tIn = sum(tin.map((x) => x.tok)) ?? 0, tOut = sum(tout.map((x) => x.tok)) ?? 0;
    const remaining = bought != null && sold != null ? Math.max(0, bought + tIn - sold - tOut) : null;

    let status: PositionStatus;
    if (!sells.length) status = "OPEN";
    else if (bought != null && sold != null && bought > 0) status = sold >= CLOSE_SOLD_SHARE * bought ? "CLOSED" : "PARTIAL";
    else status = "PARTIAL"; // token amounts unknown → cannot prove the round-trip finished

    const first_buy_at = sorted(buys.map((b) => b.at))[0] ?? null;
    const last_sell_at = sorted(sells.map((s) => s.at)).at(-1) ?? null;
    const closed = status === "CLOSED";
    const hold_sec = closed && first_buy_at && last_sell_at
      ? Math.max(0, Math.round((Date.parse(last_sell_at) - Date.parse(first_buy_at)) / 1000)) : null;
    const realized = status === "PARTIAL" && bought && sold != null
      ? sol_received - sol_spent * Math.min(1, sold / bought) : closed ? sol_received - sol_spent : null;

    out.push({
      ...base, first_buy_at, last_sell_at,
      first_trade_at: tradeTimes[0] ?? null, last_trade_at: tradeTimes.at(-1) ?? null,
      sol_spent: +sol_spent.toFixed(6), sol_received: +sol_received.toFixed(6),
      tokens_bought: r6(bought), tokens_sold: r6(sold), remaining_tokens: r6(remaining),
      realized_sol: r6(realized),
      roi: closed && sol_spent > 0 ? +(sol_received / sol_spent).toFixed(4) : null,
      hold_sec, position_status: status, is_closed: closed,
    });
  }
  return out;
}

export async function runOutcomeEngine(wallets: string[], deps: OutcomeDeps, since: string | null = null): Promise<OutcomeCounters> {
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
