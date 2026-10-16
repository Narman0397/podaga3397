<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Background cluster tracing runs server-side in src/lib/cluster-worker.server.ts via pg_cron -> /api/public/hooks/cluster-worker; a DB replay guard (cluster_worker row) limits runs because the cron bearer is only the publishable key.
- Wallet tag presentation uses the shared WalletTag component and label map, keeping display text separate from persisted tags and trading decisions.
- Memory state updates merge by wallet address and cloud synchronization only upserts; database client grants prohibit deletion to enforce permanent retention.
- Master Plan Tere edge helpers live in src/lib/edge.ts as pure functions so browser and worker share them.
- Open paper positions get live prices via Helius accountSubscribe in src/lib/price-stream.ts (toggle helius.priceStream); the server exit engine is also triggered by a Helius webhook at /api/public/hooks/helius (auth header = HELIUS_WEBHOOK_SECRET), auto-registered by the cron worker for open-position mints.
- Master Plan Pisces signal logic (tiering, dust, fresh/bundle, family, win-rate class) is pure in src/lib/edge.ts; live cabal WebSocket stream lives in src/lib/stream.ts (browser-only, toggle helius.stream) so quota stays opt-in.
- Daily top-volume scan and 6h Alpha Whale hunter run inside the cluster worker, gated by cluster_worker rows 'topvol'/'alpha'; Radar reads results from scan_history kind='topvol' (excluded from history sync) so browser state saves never overwrite them.
- Auto-buy tag gate (Golden Setup) is a pure rule in src/lib/edge.ts (goldenSetup); browser uses full intel, worker uses holder-tag approximation — keeps both paths consistent and testable.
- Shared constants and pure math (Pump programs, trace TTL, swap fee, curve %, proceeds, bundle score, TopTok) live in src/lib/edge.ts; browser and worker import them so both paths compute identically.
