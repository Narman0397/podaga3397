REVOKE DELETE, TRUNCATE ON TABLE public.wallet_tags FROM authenticated, anon, PUBLIC;
DROP POLICY IF EXISTS "own tags delete" ON public.wallet_tags;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wallet_tags TO authenticated;
COMMENT ON TABLE public.wallet_tags IS 'Permanent wallet Memory: application users may read, add and update wallets, but cannot delete them.';