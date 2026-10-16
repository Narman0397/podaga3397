// Master Plan Tere — pure helpers for the 4 edge phases (no network, no state writes).

/** Phase 1: known exchange / bridge hot wallets that must never be treated as a cluster funder. */
export const CEX_HOT_WALLETS: Record<string, string> = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance Hot 1",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance Hot 2",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance Hot 3",
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": "Bybit Hot",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": "Coinbase",
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": "Coinbase 2",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": "Kraken",
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": "OKX",
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD": "OKX 2",
  "BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6": "KuCoin",
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w": "Gate.io",
  "A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR": "Bitget",
  "G9X7F4JzLzbSGMCndiBdWNi5YzBZakmtDsQjy1bQv1Fp": "MEXC",
};
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const isExchange = (a: string, blacklist: (a: string) => string | null) => CEX_HOT_WALLETS[a] ?? blacklist(a);

/** Phase 3: wallets that collect outflows from ≥2 cluster members are sweepers (profit sink / real master). */
export function findSweepers(flows: { from: string; to: string; sol: number }[], members: Set<string>, minFrom = 2) {
  const agg = new Map<string, { from: Set<string>; sol: number }>();
  for (const f of flows) {
    if (!members.has(f.from) || members.has(f.to)) continue;
    const e = agg.get(f.to) ?? { from: new Set<string>(), sol: 0 };
    e.from.add(f.from); e.sol += f.sol; agg.set(f.to, e);
  }
  return [...agg].filter(([, v]) => v.from.size >= minFrom)
    .map(([address, v]) => ({ address, sources: v.from.size, sol: +v.sol.toFixed(3) }))
    .sort((a, b) => b.sources - a.sources || b.sol - a.sol);
}

export type PerfClass = "alpha" | "churner" | "neutral";
export interface WalletPerf { winRate: number; avgRoi: number; holdSec: number; tokens: number; cls: PerfClass; at: number }

/** Phase 4 / Pisces 5+6: wallet reputation, −100 (serial rugger) .. +100. Uses log2(seen) plus win-rate class. */
export function walletScore(m: { tag: "rugger" | "cabal" | "watch"; seen: number; perf?: WalletPerf | null | undefined } | undefined): number {
  if (!m) return 0;
  const rep = Math.min(40, Math.log2(1 + m.seen) * 12);
  if (m.tag === "rugger") return -100;
  const adj = m.perf?.cls === "alpha" ? 20 : m.perf?.cls === "churner" ? -20 : 0;
  const base = m.tag === "cabal" ? 40 + rep : rep / 2;
  return Math.max(-100, Math.min(100, Math.round(base + adj)));
}

/** Pisces 6: classify a track record over the last ≤10 traded tokens. */
export function classifyPerf(trades: { roi: number; holdSec: number }[]): Omit<WalletPerf, "at"> {
  const n = trades.length;
  if (!n) return { winRate: 0, avgRoi: 0, holdSec: 0, tokens: 0, cls: "neutral" };
  const winRate = Math.round((trades.filter((t) => t.roi > 1).length / n) * 100);
  const avgRoi = +(trades.reduce((a, t) => a + t.roi, 0) / n).toFixed(2);
  const holds = trades.map((t) => t.holdSec).sort((a, b) => a - b);
  const holdSec = Math.round(holds[Math.floor(n / 2)] ?? 0);
  const cls: PerfClass = n >= 3 && winRate >= 60 && avgRoi >= 2 ? "alpha" : n >= 3 && holdSec < 180 && avgRoi < 1.15 ? "churner" : "neutral";
  return { winRate, avgRoi, holdSec, tokens: n, cls };
}

/** Pisces 2: anti-dust — a holding counts only when ≥0.5% supply or worth ≥0.2 SOL. */
export const DUST_PCT = 0.5, DUST_SOL = 0.2, FRESH_SEC = 900, BUNDLE_SEC = 30;
export const isDust = (pct: number, mcapUsd: number, solPx: number) => pct < DUST_PCT && !(solPx > 0 && (pct / 100) * mcapUsd / solPx >= DUST_SOL);

/** Pisces 9: master prefix of a memory entry (from "sub-wallet of XXXXXX…" notes, or itself when it is a master). */
export function masterOf(m: { address: string; note: string }): string | null {
  const k = m.note.match(/sub-wallet of (\w{6})/); if (k) return k[1]!;
  return /master/i.test(m.note) ? m.address.slice(0, 6) : null;
}

export interface EdgeIntel { cabalWallets: number; watchWallets?: number; rugger: boolean; devDump: boolean; coordinated: boolean; earlyTagged: number; exits: number; repMax?: number; fresh?: number; mode?: "bundle" | "dca" | null; sameMaster?: boolean; alpha?: number; churner?: number }
/** Pisces 1–9: token edge score 0..100. Rugger / dev dump always yields 0. */
export function tokenEdgeScore(i: EdgeIntel, clusterPct: number | null): number {
  if (i.rugger || i.devDump) return 0;
  const watch = i.watchWallets ?? 0;
  let s = 20;
  s += Math.min(40, i.cabalWallets * 20);
  s += Math.min(15, watch * 5);
  s += Math.min(20, Math.max(0, (i.repMax ?? 0) / 4));
  s += Math.min(10, i.earlyTagged * 3);
  if (i.cabalWallets + watch > 0) s += (i.fresh ?? 0) > 0 ? 10 : -10; // fresh inflow vs stale holding
  if (i.mode === "bundle") s += 10; else if (i.coordinated) s += 5;
  if (i.sameMaster) s -= 5;
  s += Math.min(15, (i.alpha ?? 0) * 10) - (i.churner ?? 0) * 10;
  s -= Math.min(45, i.exits * 15);
  if (clusterPct !== null && clusterPct > 35) s -= 20;
  return Math.max(0, Math.min(100, Math.round(s)));
}
export const edgeGrade = (s: number) => s >= 85 ? "S" : s >= 70 ? "A" : s >= 55 ? "B" : s >= 40 ? "C" : "D";

/** Alpha Whale rule (Radar hunter): win-rate >60%, positive ROI (avg >1×), at least 3 closed tokens. */
export const isAlphaWhale = (p: { winRate: number; avgRoi: number; tokens: number } | null | undefined) => !!p && p.winRate > 60 && p.avgRoi > 1 && p.tokens >= 3;

/** Daily scan: Solana pairs ranked by 24h volume, one pair per mint, minimum liquidity, top `n`. */
export function pickTopVolume<T extends { chainId?: string; baseToken: { address: string }; volume?: { h24?: number }; liquidity?: { usd?: number } }>(pairs: T[], minLiq: number, n = 30): T[] {
  const best = new Map<string, T>();
  for (const p of pairs) {
    if (!p?.baseToken?.address || (p.chainId && p.chainId !== "solana") || (p.liquidity?.usd ?? 0) < minLiq) continue;
    const ex = best.get(p.baseToken.address);
    if (!ex || (p.volume?.h24 ?? 0) > (ex.volume?.h24 ?? 0)) best.set(p.baseToken.address, p);
  }
  return [...best.values()].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)).slice(0, n);
}

/** Golden Setup tag gate for auto-buy: verified cabal + fresh inflow + coordination, no exits/dev dump/rugger, edge ≥ minScore (default 70 = grade A). */
export function goldenSetup(i: EdgeIntel, score: number, minScore = 70): { ok: boolean; fails: string[] } {
  const fails: string[] = [];
  if (i.rugger) fails.push("Serial Rugger");
  if (i.devDump) fails.push("Dev Dump");
  if (i.exits > 0) fails.push(`${i.exits} cluster exit`);
  if (i.cabalWallets < 1) fails.push("Tanpa Verified Cabal");
  if ((i.fresh ?? 0) < 1) fails.push("Tanpa Active Inflow");
  if (!(i.mode === "bundle" || i.coordinated || i.earlyTagged >= 2)) fails.push("Tanpa koordinasi");
  if ((i.churner ?? 0) > (i.alpha ?? 0)) fails.push("Didominasi churner");
  if (score < minScore) fails.push(`Edge ${score} < ${minScore}`);
  return { ok: fails.length === 0, fails };
}

export interface MintTx { timestamp: number; tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint: string }[] }
/** Server Golden Setup intel from recent mint transactions + wallet tags (fresh ≤15m, coordinated ≤10m, exits ≤15m). */
export function serverIntel(mint: string, txs: MintTx[], tags: Map<string, string>, cabal: number, watch: number, _top10: number, nowMs = Date.now()): EdgeIntel {
  const now = nowMs / 1000; const ins: { w: string; at: number }[] = []; const exits = new Set<string>(); let rugger = false;
  for (const t of txs) for (const x of t.tokenTransfers ?? []) {
    if (x.mint !== mint) continue;
    const tt = x.toUserAccount ? tags.get(x.toUserAccount) : undefined, ft = x.fromUserAccount ? tags.get(x.fromUserAccount) : undefined;
    if (tt === "rugger" || ft === "rugger") rugger = true;
    if (tt === "cabal" || tt === "watch") ins.push({ w: x.toUserAccount!, at: t.timestamp });
    if ((ft === "cabal" || ft === "watch") && now - t.timestamp <= 900) exits.add(x.fromUserAccount!);
  }
  const fresh = new Set(ins.filter((y) => now - y.at <= FRESH_SEC).map((y) => y.w)).size;
  const coordinated = ins.some((a) => new Set(ins.filter((y) => y.at >= a.at && y.at - a.at <= 600).map((y) => y.w)).size >= 2);
  const bundle = ins.some((a) => new Set(ins.filter((y) => y.at >= a.at && y.at - a.at <= BUNDLE_SEC).map((y) => y.w)).size >= 2);
  return { cabalWallets: cabal, watchWallets: watch, rugger, devDump: false, coordinated, earlyTagged: new Set(ins.map((y) => y.w)).size, exits: exits.size, fresh, mode: bundle ? "bundle" : null };
}

// ---- Shared constants & pure math (browser + worker) ----
export const PUMP_PROGRAMS = new Set(["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg", "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"]);
export const TRACE_TTL = 30 * 60_000;
export const SWAP_FEE = 0.0025;
/** Pump.fun bonding-curve progress (%), from SOL pooled (85 SOL = graduate) or market cap fallback ($69k). */
export const curvePctOf = (solPooled?: number | null, mcap?: number | null) => Math.min(100, solPooled ? (solPooled / 85) * 100 : ((mcap ?? 0) / 69_000) * 100);
/** SOL received when selling `fraction` of qty at price, with pool impact + swap fee. */
export const proceedsSol = (qty: number, price: number, sol: number, liq: number, fraction = 1) => { const usd = qty * fraction * price; const imp = liq > 0 ? usd / (liq / 2 + usd) : 0; return (usd * (1 - imp) * (1 - SWAP_FEE)) / sol; };
/** Funding uniformity + time window -> bundle score (0-100). */
export function bundleMetrics(amts: number[], times: number[]) {
  if (amts.length < 2) return { uniformity: 0, windowSec: 0, bundleScore: 0 };
  const mean = amts.reduce((a, b) => a + b, 0) / amts.length;
  const sd = Math.sqrt(amts.reduce((a, b) => a + (b - mean) ** 2, 0) / amts.length);
  const uniformity = Math.max(0, 100 - (sd / (mean || 1)) * 100);
  const windowSec = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 1000 : 0;
  return { uniformity, windowSec, bundleScore: Math.round(uniformity * 0.6 + Math.max(0, 100 - windowSec / 36) * 0.4) };
}
export type TopTok = { mint: string; symbol: string; vol24: number; liq: number; tier: string; track: "dex" | "pump" };
