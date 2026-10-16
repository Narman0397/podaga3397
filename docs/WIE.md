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

## Phase 2 (done) — Outcome Engine
- Table: `wallet_outcomes` (idempotent on wallet+mint; stores buy/sell aggregates: roi, hold_sec, sol_spent, sol_received, is_closed, outcome_version).
- Code: `src/lib/wallet-intelligence/outcomes.ts` (pure, injected adapters — `computeOutcomes`, `runOutcomeEngine`).
- Server adapters: `src/lib/wallet-intelligence/outcome-jobs.server.ts` — `runOutcomeJob`.
- Worker job `wie-outcomes`: every 1h, processes all wallets with buy/sell events in wallet_events → upserts wallet_outcomes.
- Design: multiple buys accumulate sol_spent; last sell closes the position; failed_tx events ignored; sol_transfer/token_transfer skipped.

## Phase 3 (done) — Alpha Scoring v2
- Table: `wallet_score_history` (append-only per scoring run: win_rate, avg_roi, hold_sec, tokens_closed, confidence, score, cls, score_version).
- Code: `src/lib/wallet-intelligence/scoring-v2.ts` (pure — `tradeConfidence`, `scoreWalletV2`, `runScoringV2`).
- Server adapters: `runScoringJob` in `outcome-jobs.server.ts`.
- Worker job `wie-score`: every 6h, scores wallets with ≥1 closed outcome → writes wallet_score_history row → updates wallet_tags.perf for all users.
- Confidence formula: `95 * (1 - e^(-n/8))` — 0 at 0 trades, ≈50 at 5 trades, ≈80 at 10 trades, caps at 95.
- Classification: alpha = WR≥60% + avgROI≥1.5× + ≥3 trades; churner = hold<180s + avgROI<1.1 + ≥3 trades; else neutral.
- Score = weighted by confidence so low-sample wallets can't reach high scores.
- Recent trades (most recent half) are weighted 2× in avg_roi calculation.
- Replaces classifyPerf (last 10 tokens, in-memory) with persistent, versioned, history-tracked scoring.

## Phase 4–5 (done) — Early entry, attribution, token risk, execution
- Table: `wallet_signals` (one row per tracked-wallet buy, unique signature+wallet+mint; source/detect/signal times, source vs signal price, delay, entry_status EARLY/LATE/INSUFFICIENT_DATA, risk + confidence + reasons, simulated execution, horizons 5m/15m/1h/24h, MFE/MAE, risk re-check).
- Code: `signals.ts` (pure) + `signal-jobs.server.ts`; job `wie-signals` every 5 min, DexScreener prices only; horizons past 30 min tolerance are marked missed, never backfilled.
- Attribution is correlational, needs >=5 evaluated signals, compares net (after cost) return to the all-signal baseline. Simulation only, no live execution.

## Phase 6 (done) — Wallet Graph
- Table `wallet_relations` (unique wallet_a+wallet_b+relation; evidence ≤20 signatures, first/last seen, frequency, confidence, status observed/suspected/strong_evidence/rejected, reasons, rule_version).
- Code `graph.ts` (pure): funding = direct SOL transfers (counterparty now kept in raw_ref, normalizer wie-norm-1.1.0); co_entry = tracked wallets buying the same token within 60s (never above "suspected"); exchange counterparties → rejected; duplicate evidence not double counted; one-hop bounded neighbourhood (60 nodes/120 edges).
- Job `wie-graph` every 6h over the last 30 days of events.

## Phase 7 (done) — Gate + temporal backtest
- `gate.ts`: ACCEPT/WATCH/REJECT/INSUFFICIENT_DATA with separate alpha/early/relationship/risk/execution/confidence/data-quality scores, reasons, version. Baseline weights 40/35/25 are experimental. ACCEPT only opens paper/simulation. Uses only score history known at signal time. Stored on `wallet_signals.gate*`; job `wie-gate` every 5 min.
- `backtest.ts`: chronological 60/40 split, net of estimated cost, missing follow-up price counted −100%, unfinished horizons excluded and reported, ungated baseline. Stored in `wie_backtests` per horizon (15m/1h/24h); job `wie-backtest` every 24h.

## Phase 8 (done) — Dashboard
- Route `/wie` (menu "Wallet Intelligence"): Overview (wallets, sample sufficiency, relations, gate counts, latest signals with reasons), Wallet detail (score history, per-token outcome chart, bounded relation graph with evidence), Backtest, Job Monitor. Empty/guest/error states shown; no demo numbers.

## Running
- Scheduler: managed cron `cluster-worker` (every minute) POSTs to `/api/public/hooks/cluster-worker`; sub-jobs gate themselves (main 50s, collector 30m, signals 5m, gate 5m, outcomes 1h, score 6h, graph 6h, backtest 24h, top-volume 24h, alpha 6h).
- Env (server only): `LOVABLE_CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, optional `HELIUS_WEBHOOK_SECRET`. Helius keys come from each user's saved settings.
- Tests: `bunx vitest run`.

## Backlog
- Wallet role classification beyond alpha/churner/neutral; per-category/market-condition backtest breakdown.
