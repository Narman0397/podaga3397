CREATE TABLE public.wallet_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL,
  mint text NOT NULL,
  signature text NOT NULL,
  source_tx_at timestamptz,
  detected_at timestamptz,
  signal_at timestamptz NOT NULL DEFAULT now(),
  delay_sec integer,
  source_price_sol numeric,
  signal_price_sol numeric,
  price_move_pct numeric,
  liquidity_usd numeric,
  volume_h24_usd numeric,
  pool_age_min integer,
  entry_status text NOT NULL,
  risk_score integer,
  risk_confidence integer NOT NULL DEFAULT 0,
  risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution jsonb NOT NULL DEFAULT '{}'::jsonb,
  horizons jsonb NOT NULL DEFAULT '{}'::jsonb,
  mfe_pct numeric,
  mae_pct numeric,
  risk_recheck jsonb,
  signal_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signature, wallet, mint)
);
CREATE INDEX wallet_signals_wallet_idx ON public.wallet_signals (wallet, signal_at DESC);
CREATE INDEX wallet_signals_signal_at_idx ON public.wallet_signals (signal_at DESC);
GRANT SELECT ON public.wallet_signals TO authenticated;
GRANT ALL ON public.wallet_signals TO service_role;
ALTER TABLE public.wallet_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in read signals" ON public.wallet_signals FOR SELECT TO authenticated USING (true);