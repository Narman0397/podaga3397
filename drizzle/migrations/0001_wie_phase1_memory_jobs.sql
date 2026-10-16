-- WIE V2.1 Phase 1: job run log, normalized wallet events, per-wallet collector checkpoint, atomic job lock.
CREATE TABLE public.wie_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','skipped')),
  source text NOT NULL DEFAULT 'cron',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  records_seen integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_skipped integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX wie_job_runs_job_started_idx ON public.wie_job_runs (job_name, started_at DESC);
CREATE INDEX wie_job_runs_status_idx ON public.wie_job_runs (status);
GRANT SELECT ON public.wie_job_runs TO authenticated;
GRANT ALL ON public.wie_job_runs TO service_role;
ALTER TABLE public.wie_job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in read job runs" ON public.wie_job_runs FOR SELECT TO authenticated USING (true);
COMMENT ON TABLE public.wie_job_runs IS 'WIE worker observability. Written only by server jobs; error_summary is sanitized (no keys/URLs).';

CREATE TABLE public.wallet_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL,
  signature text NOT NULL,
  event_index integer NOT NULL,
  slot bigint,
  block_time timestamptz,
  activity text NOT NULL,
  mint text,
  direction text CHECK (direction IN ('in','out')),
  token_amount numeric,
  sol_amount numeric,
  price_sol numeric,
  source text NOT NULL,
  parse_status text NOT NULL,
  completeness text NOT NULL,
  raw_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalizer_version text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signature, wallet, event_index)
);
CREATE INDEX wallet_events_wallet_time_idx ON public.wallet_events (wallet, block_time DESC);
CREATE INDEX wallet_events_mint_time_idx ON public.wallet_events (mint, block_time DESC);
CREATE INDEX wallet_events_signature_idx ON public.wallet_events (signature);
GRANT SELECT ON public.wallet_events TO authenticated;
GRANT ALL ON public.wallet_events TO service_role;
ALTER TABLE public.wallet_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in read public chain events" ON public.wallet_events FOR SELECT TO authenticated USING (true);
COMMENT ON TABLE public.wallet_events IS 'Normalized public on-chain wallet activity (no user data). Idempotent on (signature, wallet, event_index). Unknown values stay NULL, never 0.';

CREATE TABLE public.wallet_collect_state (
  wallet text PRIMARY KEY,
  newest_signature text,
  newest_block_time timestamptz,
  events_count integer NOT NULL DEFAULT 0,
  history_complete boolean NOT NULL DEFAULT false,
  possible_gap boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_collect_state_last_run_idx ON public.wallet_collect_state (last_run_at NULLS FIRST);
GRANT SELECT ON public.wallet_collect_state TO authenticated;
GRANT ALL ON public.wallet_collect_state TO service_role;
ALTER TABLE public.wallet_collect_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in read collect state" ON public.wallet_collect_state FOR SELECT TO authenticated USING (true);

-- Atomic gate: returns true for exactly one caller per interval (replaces read-then-write race).
CREATE OR REPLACE FUNCTION public.wie_try_lock(_job text, _every_ms integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE got text;
BEGIN
  INSERT INTO public.cluster_worker (id, ran_at) VALUES (_job, now())
  ON CONFLICT (id) DO UPDATE SET ran_at = now()
    WHERE public.cluster_worker.ran_at < now() - make_interval(secs => _every_ms / 1000.0)
  RETURNING id INTO got;
  RETURN got IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.wie_try_lock(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_try_lock(text, integer) TO service_role;