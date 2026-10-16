
-- =========================================================
-- WIE V2.1 Phase 2: Outcome Engine
-- =========================================================
-- Per-(wallet, mint) closed/open position outcome derived from wallet_events.
-- is_closed = true when sol_received > 0 after at least one buy.
-- Idempotent: upsert on (wallet, mint).
CREATE TABLE public.wallet_outcomes (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  wallet            text        NOT NULL,
  mint              text        NOT NULL,
  first_buy_at      timestamptz,
  last_sell_at      timestamptz,
  buy_count         integer     NOT NULL DEFAULT 0,
  sell_count        integer     NOT NULL DEFAULT 0,
  sol_spent         numeric     NOT NULL DEFAULT 0,
  sol_received      numeric     NOT NULL DEFAULT 0,
  roi               numeric,                        -- sol_received / sol_spent, NULL if not closeable
  hold_sec          integer,                        -- seconds between first buy and last sell, NULL if open
  is_closed         boolean     NOT NULL DEFAULT false,
  outcome_version   text        NOT NULL DEFAULT 'wie-out-1.0.0',
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (wallet, mint)
);

GRANT SELECT ON public.wallet_outcomes TO authenticated;
GRANT ALL    ON public.wallet_outcomes TO service_role;

ALTER TABLE public.wallet_outcomes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read any wallet outcome (chain data is public).
CREATE POLICY "signed-in read outcomes"
  ON public.wallet_outcomes FOR SELECT
  TO authenticated
  USING (true);

-- =========================================================
-- WIE V2.1 Phase 3: Alpha Scoring v2 — history table
-- =========================================================
-- One row per scoring run per wallet; keeps full history for backtest (Phase 7).
CREATE TABLE public.wallet_score_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  wallet          text        NOT NULL,
  scored_at       timestamptz NOT NULL DEFAULT now(),
  win_rate        integer     NOT NULL,       -- 0-100 %
  avg_roi         numeric     NOT NULL,       -- multiple e.g. 1.45 = 45% profit
  hold_sec        integer     NOT NULL,       -- median hold seconds
  tokens_closed   integer     NOT NULL,       -- number of closed trades used
  confidence      integer     NOT NULL,       -- 0-100; low = few trades
  score           integer     NOT NULL,       -- walletScore output 0-100
  cls             text        NOT NULL,       -- 'alpha' | 'churner' | 'neutral'
  score_version   text        NOT NULL DEFAULT 'wie-score-2.0.0',
  PRIMARY KEY (id)
);

CREATE INDEX wallet_score_history_wallet_idx ON public.wallet_score_history (wallet, scored_at DESC);

GRANT SELECT ON public.wallet_score_history TO authenticated;
GRANT ALL    ON public.wallet_score_history TO service_role;

ALTER TABLE public.wallet_score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed-in read score history"
  ON public.wallet_score_history FOR SELECT
  TO authenticated
  USING (true);

-- =========================================================
-- WIE V2.1 Phase 2: add job labels for new jobs
-- (wie_job_runs already exists; no schema change needed)
-- =========================================================
-- Record Phase 2/3 job names in wie_job_runs.job_name check: no constraint exists, free text is fine.
-- Nothing else needed in DB for new jobs.
