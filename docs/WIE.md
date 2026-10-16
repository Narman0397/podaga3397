# Wallet Intelligence Engine (WIE) V2.1 — status

## Phase 0 audit (baseline)
- Baseline: 33 tests passing; build OK before WIE changes.
- Flow found: Helius/DexScreener -> cluster worker (pg_cron every minute -> /api/public/hooks/cluster-worker) -> wallet_tags (per-user Memory) -> edge.ts scoring (walletScore, classifyPerf, isAlphaWhale, tokenEdgeScore, goldenSetup) -> sentinel/real (browser) and server paper auto-buy/exit tracker.
- No raw on-chain event storage existed; track records (`perf`) are computed from the last ≤10 tokens and kept only as the latest value (no history, no version).
- Risks fixed in Phase 1: job gates were read-then-write (concurrent calls could both run) -> replaced by atomic `wie_try_lock`; the hook only checked that *some* bearer existed -> now uses the managed cron secret.
- Risks still open: `scan_history` is UNIQUE(user_id,address) so it cannot be an event log (WIE uses separate tables); topvol replaces rows via delete+insert; server auto-buy is paper-only (no live execution exists — keep it that way).

## Phase 1 (done)
- Tables: `wallet_events` (idempotent on signature+wallet+event_index, unknown values NULL), `wallet_collect_state` (per-wallet checkpoint, `possible_gap` when a full page was returned), `wie_job_runs` (status, counters, duration, sanitized error).
- Code: `src/lib/wallet-intelligence/` — `normalize.ts`, `collector.ts` (pure, injected adapters), `jobs.ts`, `job-runs.server.ts`.
- Worker job `wie-collect`: every 30 min, max 10 tagged wallets × 100 tx (≈480 Helius calls/day max), uses users' own Helius keys, oldest-checked wallets first.
- UI: Job Monitor panel on the Memory page.

## Running
- Scheduler: managed cron `cluster-worker` (every minute) POSTs to `/api/public/hooks/cluster-worker`; sub-jobs gate themselves (main 50s, collector 30m, top-volume 24h, alpha 6h).
- Env (server only): `LOVABLE_CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, optional `HELIUS_WEBHOOK_SECRET`. Helius keys come from each user's saved settings.
- Tests: `bunx vitest run`.

## Backlog
2 Outcome engine (signals + horizon outcomes) · 3 alpha scoring v2 with confidence/version/history · 4 early entry + attribution · 5 token risk + execution · 6 evidence-based wallet graph · 7 gate + temporal backtest · 8 full dashboard pages.
