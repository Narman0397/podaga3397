CREATE TABLE public.wallet_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  address text NOT NULL,
  tag text NOT NULL,
  note text NOT NULL DEFAULT '',
  seen integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, address)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_tags TO authenticated;
GRANT ALL ON public.wallet_tags TO service_role;
ALTER TABLE public.wallet_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tags select" ON public.wallet_tags FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own tags insert" ON public.wallet_tags FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own tags update" ON public.wallet_tags FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own tags delete" ON public.wallet_tags FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.scan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  address text NOT NULL,
  kind text NOT NULL,
  summary text NOT NULL DEFAULT '',
  scanned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, address)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_history TO authenticated;
GRANT ALL ON public.scan_history TO service_role;
ALTER TABLE public.scan_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scans select" ON public.scan_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own scans insert" ON public.scan_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own scans update" ON public.scan_history FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own scans delete" ON public.scan_history FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.user_state (
  user_id uuid PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_state TO authenticated;
GRANT ALL ON public.user_state TO service_role;
ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own state select" ON public.user_state FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own state insert" ON public.user_state FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own state update" ON public.user_state FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own state delete" ON public.user_state FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.cluster_worker (
  id text PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  traced jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.cluster_worker TO service_role;
ALTER TABLE public.cluster_worker ENABLE ROW LEVEL SECURITY;