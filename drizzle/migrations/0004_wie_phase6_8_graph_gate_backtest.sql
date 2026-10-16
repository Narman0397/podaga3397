CREATE TABLE public.wallet_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_a text NOT NULL,
  wallet_b text NOT NULL,
  relation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen timestamptz,
  last_seen timestamptz,
  frequency integer NOT NULL DEFAULT 0,
  confidence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'observed',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_a, wallet_b, relation)
);
CREATE INDEX wallet_relations_a ON public.wallet_relations (wallet_a);
CREATE INDEX wallet_relations_b ON public.wallet_relations (wallet_b);
GRANT SELECT ON public.wallet_relations TO authenticated;
GRANT ALL ON public.wallet_relations TO service_role;
ALTER TABLE public.wallet_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in read relations" ON public.wallet_relations FOR SELECT TO authenticated USING (true);

ALTER TABLE public.wallet_signals ADD COLUMN gate_decision text;
ALTER TABLE public.wallet_signals ADD COLUMN gate jsonb;
ALTER TABLE public.wallet_signals ADD COLUMN gate_at timestamptz;

CREATE TABLE public.wie_backtests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  backtest_version text NOT NULL,
  horizon text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  train_from timestamptz, train_to timestamptz,
  test_from timestamptz, test_to timestamptz,
  train jsonb NOT NULL DEFAULT '{}'::jsonb,
  test jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
);
GRANT SELECT ON public.wie_backtests TO authenticated;
GRANT ALL ON public.wie_backtests TO service_role;
ALTER TABLE public.wie_backtests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in read backtests" ON public.wie_backtests FOR SELECT TO authenticated USING (true);