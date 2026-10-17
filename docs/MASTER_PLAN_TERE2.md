# Master Plan Tere 2 — Pematangan Trading Edge WIE

- **A. Filter mint quote**: WSOL/USDC/USDT (`QUOTE_MINTS` di normalize.ts) tidak pernah jadi target sinyal; normalizer `wie-norm-1.2.0`; signal job juga melewati quote mint.
- **B. Realtime**: webhook Helius `/api/public/hooks/helius` ikut memantau wallet alpha (≤100 alamat bersama mint posisi); tx wallet terlacak langsung masuk `wallet_events` dan memicu signal pass (`realtime.server.ts`, job `wie-realtime`).
- **C. Radar**: lencana WIE ACCEPT/WATCH (24 jam) + popover (wallet, skor, risiko, fee) + 1-Click Paper Buy + filter "Hanya Sinyal WIE".
- **D. Interkoneksi**: `/wie?tab=detail&wallet=…`; Memory & Radar punya aksi WIE/Trace/salin; tombol Audit CA di kartu Radar; tabel sinyal WIE bisa diklik; tab Pending menampilkan kartu token yang sedang diverifikasi.
- **E. Edge**: `edgeVerdict` — terbukti hanya jika n ACCEPT uji ≥ 30, win rate > baseline, profit factor > 1.2; ditampilkan di tab Backtest.
