import { CEX_HOT_WALLETS, PUMP_PROGRAMS } from "../edge";

/** Wallet Discovery: memperkaya daftar wallet yang dipantau WIE dari pemegang awal token yang sedang bergerak. */
export const DISCOVERY_LIMITS = {
  mintsPerRun: 8,
  holdersPerMint: 12,
  maxHolderPct: 20,
  maxNewPerRun: 40,
  everyMs: 6 * 3_600_000,
} as const;

export interface HolderCand {
  owner: string;
  pct: number;
}

/**
 * Pilih kandidat wallet dari daftar pemegang terbesar sebuah token.
 * Membuang program Pump.fun, hot wallet bursa, dan pemegang >20% suplai (kemungkinan pool/dev).
 * Murni dan deterministik sehingga bisa diuji tanpa jaringan.
 */
export function pickHolderCandidates(
  holders: HolderCand[],
  opts: { perMint?: number; maxPct?: number; exclude?: (a: string) => boolean } = {},
): string[] {
  const perMint = opts.perMint ?? DISCOVERY_LIMITS.holdersPerMint;
  const maxPct = opts.maxPct ?? DISCOVERY_LIMITS.maxHolderPct;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of holders) {
    if (!h.owner || seen.has(h.owner)) continue;
    if (h.pct > maxPct) continue;
    if (PUMP_PROGRAMS.has(h.owner) || CEX_HOT_WALLETS[h.owner]) continue;
    if (opts.exclude?.(h.owner)) continue;
    seen.add(h.owner);
    out.push(h.owner);
    if (out.length >= perMint) break;
  }
  return out;
}

/** Gabungkan kandidat dari banyak mint, dedupe, dan batasi total per putaran. */
export function mergeCandidates(byMint: Map<string, string[]>, maxTotal = DISCOVERY_LIMITS.maxNewPerRun): Map<string, string> {
  const out = new Map<string, string>(); // wallet -> via mint
  for (const [mint, wallets] of byMint) {
    for (const w of wallets) {
      if (!out.has(w)) out.set(w, mint);
      if (out.size >= maxTotal) return out;
    }
  }
  return out;
}
