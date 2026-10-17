ALTER TABLE public.wallet_collect_state
  ADD COLUMN IF NOT EXISTS backfill_before text,
  ADD COLUMN IF NOT EXISTS pending_newest_signature text,
  ADD COLUMN IF NOT EXISTS pending_newest_block_time timestamptz;

ALTER TABLE public.wallet_outcomes
  ADD COLUMN IF NOT EXISTS position_status text NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS tokens_bought numeric,
  ADD COLUMN IF NOT EXISTS tokens_sold numeric,
  ADD COLUMN IF NOT EXISTS remaining_tokens numeric,
  ADD COLUMN IF NOT EXISTS realized_sol numeric,
  ADD COLUMN IF NOT EXISTS transfer_in_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_out_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_trade_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_trade_at timestamptz;

UPDATE public.wallet_outcomes SET position_status = CASE WHEN is_closed THEN 'CLOSED' ELSE 'OPEN' END,
  first_trade_at = first_buy_at, last_trade_at = COALESCE(last_sell_at, first_buy_at);

ALTER TABLE public.wallet_signals ADD COLUMN IF NOT EXISTS excluded_reason text;
UPDATE public.wallet_signals SET excluded_reason = 'quote_mint'
  WHERE mint IN ('So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

-- Legacy gaps: pointer already advanced; walk older history from the oldest known event.
UPDATE public.wallet_collect_state s SET
  pending_newest_signature = s.newest_signature,
  pending_newest_block_time = s.newest_block_time,
  backfill_before = (SELECT e.signature FROM public.wallet_events e WHERE e.wallet = s.wallet ORDER BY e.block_time ASC NULLS LAST LIMIT 1)
WHERE s.possible_gap = true AND s.backfill_before IS NULL;

COMMENT ON COLUMN public.wallet_outcomes.is_closed IS 'DEPRECATED: use position_status = CLOSED';
COMMENT ON COLUMN public.wallet_outcomes.first_buy_at IS 'DEPRECATED: use first_trade_at';
COMMENT ON COLUMN public.wallet_outcomes.last_sell_at IS 'DEPRECATED: use last_trade_at';