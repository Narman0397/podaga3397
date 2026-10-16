// Deterministic simulation engine, seeded by addresses so results are stable per input.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function fakeAddr(r: () => number) {
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(r() * B58.length)];
  return s;
}
export { short } from "./utils";

export interface Node { id: string; level: 0 | 1 | 2; sol: number; supplyPct: number; bought: boolean; label?: string }
export interface Edge { from: string; to: string; sol: number; at: number }
export interface Cluster {
  root: string; deployer?: string | undefined; funder?: string; origin?: string; originLabel?: string | undefined;
  nodes: Node[]; edges: Edge[]; totalSupplyPct: number; bundleScore: number; uniformity: number; windowSec: number;
  /** Holders excluded from tracing (pool/program/exchange) with reason. */
  skipped?: { owner: string; pct: number; reason: string }[];
}

export function buildCluster(seed: string, mode: "forward" | "reverse"): Cluster {
  const r = rng(seed + mode);
  const master = mode === "forward" ? seed : fakeAddr(r);
  const nodes: Node[] = [{ id: master, level: 0, sol: +(50 + r() * 450).toFixed(2), supplyPct: 0, bought: false, label: "Master" }];
  const edges: Edge[] = [];
  const now = Date.now();
  const bundle = r() > 0.45;
  const l1n = 3 + Math.floor(r() * 5);
  const base = 2 + r() * 8;
  for (let i = 0; i < l1n; i++) {
    const id = fakeAddr(r);
    const sol = +(bundle ? base * (0.97 + r() * 0.06) : base * (0.3 + r() * 1.8)).toFixed(2);
    const bought = mode === "reverse" ? r() > 0.15 : r() > 0.5;
    nodes.push({ id, level: 1, sol, supplyPct: bought ? +(0.4 + r() * 3.5).toFixed(2) : 0, bought });
    edges.push({ from: master, to: id, sol, at: now - Math.floor((bundle ? r() * 90 : r() * 7200) * 1000) });
    const l2n = Math.floor(r() * 4);
    for (let j = 0; j < l2n; j++) {
      const cid = fakeAddr(r);
      const csol = +(sol * (0.2 + r() * 0.3)).toFixed(2);
      const cb = r() > 0.4;
      nodes.push({ id: cid, level: 2, sol: csol, supplyPct: cb ? +(0.2 + r() * 2).toFixed(2) : 0, bought: cb });
      edges.push({ from: id, to: cid, sol: csol, at: now - Math.floor(r() * 3600_000) });
    }
  }
  const l1 = nodes.filter((n) => n.level === 1).map((n) => n.sol);
  const mean = l1.reduce((a, b) => a + b, 0) / l1.length;
  const sd = Math.sqrt(l1.reduce((a, b) => a + (b - mean) ** 2, 0) / l1.length);
  const uniformity = Math.max(0, 100 - (sd / mean) * 100);
  const times = edges.filter((e) => e.from === master).map((e) => e.at);
  const windowSec = Math.round((Math.max(...times) - Math.min(...times)) / 1000);
  const bundleScore = Math.round(uniformity * 0.6 + Math.max(0, 100 - windowSec / 36) * 0.4);
  const origins = ["Binance Hot 1", "Bybit Hot", "Fresh (unfunded history)", "Coinbase", "Unknown wallet", "OKX"];
  return {
    root: seed,
    deployer: mode === "reverse" ? fakeAddr(r) : undefined,
    funder: master,
    origin: fakeAddr(r),
    originLabel: origins[Math.floor(r() * origins.length)],
    nodes, edges,
    totalSupplyPct: +nodes.reduce((a, n) => a + n.supplyPct, 0).toFixed(2),
    bundleScore, uniformity: Math.round(uniformity), windowSec,
  };
}

export interface TokenMarket {
  mint: string; symbol: string; price: number; curvePct: number; migrated: boolean;
  liquidityUsd: number; virtualSol: number; virtualTokens: number; mcap: number;
  sellTax: number; honeypot: boolean; mintAuthority: string | null; freezeAuthority: string | null;
}

export function marketFor(mint: string): TokenMarket {
  const r = rng(mint);
  const curvePct = +(r() * 100).toFixed(1);
  const migrated = curvePct > 92;
  const virtualSol = 30 + curvePct * 0.55;
  const virtualTokens = 1_073_000_000 * (1 - curvePct / 130);
  const solUsd = 160;
  const price = (virtualSol / virtualTokens) * solUsd;
  const syms = ["BONKZ", "CABAL", "WIF2", "MOODENG", "GIGA", "PNUT", "RETARDIO", "ZEREBRO"];
  return {
    mint, symbol: syms[Math.floor(r() * syms.length)]!, price, curvePct: migrated ? 100 : curvePct, migrated,
    liquidityUsd: migrated ? 20000 + r() * 180000 : virtualSol * solUsd * 2,
    virtualSol, virtualTokens, mcap: price * 1_000_000_000,
    sellTax: r() > 0.85 ? +(5 + r() * 40).toFixed(1) : 0,
    honeypot: r() > 0.92,
    mintAuthority: r() > 0.8 ? fakeAddr(r) : null,
    freezeAuthority: r() > 0.85 ? fakeAddr(r) : null,
  };
}

/** Constant-product price impact (%) for buying `sol` against a pool. */
export function priceImpact(sol: number, m: TokenMarket) {
  const poolSol = m.migrated ? m.liquidityUsd / 2 / 160 : m.virtualSol;
  return (sol / (poolSol + sol)) * 100;
}

export function jitoTip(congestion: number) {
  // lamports → SOL tiers based on recent landed-bundle percentiles
  const p50 = 0.00001 + congestion * 0.00009;
  return { p25: p50 * 0.6, p50, p75: p50 * 1.8, p95: p50 * 4.2, recommended: p50 * (congestion > 0.6 ? 1.8 : 1.1) };
}

export const fmtUsd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
