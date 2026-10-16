# Rencana: Pemindaian Volume Harian, Pemburu Alpha Whale, dan Inspeksi F7p3…gmNe

## 1. Pemindaian harian token volume tertinggi (DexScreener → Radar)
- Sekali sehari, worker 24/7 mengambil token Solana dengan volume 24 jam tertinggi dari DexScreener (maks 30 token, likuiditas minimal mengikuti filter Radar yang ada).
- Tiap token diklasifikasikan otomatis memakai logika Radar yang sudah ada (jalur Pump.fun pre-Raydium vs DEX/AMM, tier, skor edge).
- Hasil disimpan ke riwayat pemindaian akun sehingga muncul di Radar dengan badge "Top Volume Harian" dan waktu pemindaian.
- Ada toggle ON/OFF di halaman Keys (default ON) dan tidak memakai panggilan Helius tambahan selain verifikasi yang sudah ada.

## 2. Pemburu Alpha Whale berkala (Radar → Memory)
- Setiap 6 jam, worker mengambil token Radar terbaru (maks 10 token), lalu mengumpulkan pemegang terbesar dan pembeli awal (maks 10 wallet per token, kecuali pool, bursa, dan pemegang >20% suplai).
- Tiap wallet dinilai win-rate/ROI dengan track record yang sudah ada (dilewati bila sudah dinilai dalam 24 jam).
- Syarat Alpha Whale: win-rate >60%, ROI positif, minimal 3 token tertutup.
- Wallet baru disimpan sebagai Kandidat Cabal dengan catatan "Auto: Alpha Whale via Radar — WR x%, ROI y× (n token)"; wallet lama hanya diperbarui performanya, dan jumlah kemunculannya bertambah. Tag manual tidak ditimpa.
- Batas kuota: maks 60 penilaian per putaran; berhenti saat key Helius habis.

## 3. Inspeksi mandiri F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe
- Jalankan inspeksi yang sudah ada di halaman Memory untuk alamat ini (via browser dengan akun Anda).
- Hasil (sub-wallet, skor bundle, win-rate) disimpan ke Memory beserta relasi kluster induk-anak, lalu dicek bahwa baris muncul di tabel.
- Bila alamat sudah bertag manual, tag dipertahankan dan hanya bukti yang dilaporkan.

## Detail teknis
- Logika murni baru di `src/lib/edge.ts`: `pickTopVolume(pairs)` dan `isAlphaWhale(perf)` (WR >60, ROI >1, tokens ≥3) + tes unit.
- `src/lib/cluster-worker.server.ts`: dua tugas terjadwal dengan stempel waktu terakhir di baris `cluster_worker` (harian dan 6 jam), memakai cron per menit yang sudah ada — tidak menambah cron baru.
- Toggle baru di store (`scan.dailyTopVolume`, `scan.alphaHunter`) dan halaman Keys.
- Radar (`src/routes/index.tsx`) menampilkan badge sumber "Top Volume Harian".
- Verifikasi: tes vitest, panggilan endpoint worker, lalu Playwright untuk inspeksi F7p3 dan cek tabel Memory.
