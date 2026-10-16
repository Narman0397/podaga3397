// Pure exit rules shared by the browser tracker and the 24/7 server worker.
export interface ExitGuard { tp1?: number; trail?: number; graceSec?: number; trailArm?: number; initStop?: number; breakeven?: boolean; dumpSignal?: boolean }
export const BE_ARM = 20; export const BE_TRAIL_ARM = 50; export const BE_FEE = 0.0025; export const DUMP_WINDOW_SEC = 600;
export const EXIT_DEFAULTS = { tp1: 100, trail: 25, graceSec: 90, trailArm: 15, initStop: 40 };
type P = { entry: number; ath: number; securedPrincipal?: boolean; openedAt?: number; mirrored?: boolean | undefined };
export const MIRROR_SELL = 0.25; export const MIRROR_TRAIL = 10;

/** Prefer the canonical Pump.fun / PumpSwap pool, then the deepest pool by effective liquidity. */
export function pairRank(p: { dexId?: string; liquidity?: { usd?: number; quote?: number } }, solPx = 150) {
  const eff = p.liquidity?.usd || (p.liquidity?.quote ?? 0) * solPx * 2;
  return (p.dexId === "pumpfun" || p.dexId === "pumpswap" ? 1e12 : 0) + eff;
}

/**
 * Decide an exit. Entry includes impact, so:
 * - Grace period after open: no stop of any kind.
 * - Trailing only arms once market price reached entry +trailArm%; before that a looser initial stop (−initStop% vs entry) applies.
 */
export function exitDecision(p: P, price: number, g: ExitGuard = {}): { kind: "tp1" | "trail" | "stop"; label: string } | null {
  const c = { ...EXIT_DEFAULTS, ...Object.fromEntries(Object.entries(g).filter(([, v]) => Number(v) > 0)) } as typeof EXIT_DEFAULTS;
  if (!p.securedPrincipal && price >= p.entry * (1 + c.tp1 / 100)) return { kind: "tp1", label: `TP1 +${c.tp1}% · principal secured` };
  if (p.openedAt && Date.now() - p.openedAt < c.graceSec * 1000) return null;
  // Pisces 8: after a trigger wallet sold ≥25%, trail tightly from the peak regardless of arming.
  if (p.mirrored && price <= p.ath * (1 - MIRROR_TRAIL / 100)) return { kind: "trail", label: `Mirror trail −${MIRROR_TRAIL}% (cabal pemicu menjual)` };
  if (g.breakeven) {
    // Breakeven mode: trail 25% from peak only after +50%; after +20% stop sits at entry incl. buy+sell fee.
    if (p.ath >= p.entry * (1 + BE_TRAIL_ARM / 100)) return price <= p.ath * (1 - c.trail / 100) ? { kind: "trail", label: `Trailing stop −${c.trail}% (armed +${BE_TRAIL_ARM}%) [breakeven mode]` } : null;
    if (p.securedPrincipal || p.ath >= p.entry * (1 + BE_ARM / 100)) return price <= p.entry / (1 - BE_FEE) ** 2 ? { kind: "stop", label: `Breakeven stop (armed +${BE_ARM}%) [breakeven mode]` } : null;
    return price <= p.entry * (1 - c.initStop / 100) ? { kind: "stop", label: `Initial stop −${c.initStop}% [breakeven mode]` } : null;
  }
  const armed = p.securedPrincipal || p.ath >= p.entry * (1 + c.trailArm / 100);
  if (armed) return price <= p.ath * (1 - c.trail / 100) ? { kind: "trail", label: `Trailing stop −${c.trail}%` } : null;
  return price <= p.entry * (1 - c.initStop / 100) ? { kind: "stop", label: `Initial stop −${c.initStop}%` } : null;
}

/** A >70% one-tick crash must be confirmed by a second source within 30%, else ignored as a thin-pool anomaly. */
export function suspiciousDrop(prev: number | undefined, price: number, second: number | undefined) {
  if (!prev || price > prev * 0.3) return false;
  return !(second && Math.abs(second / price - 1) < 0.3);
}

type DTx = { timestamp: number; tokenTransfers?: { fromUserAccount: string; toUserAccount?: string; mint: string; tokenAmount?: number }[] };
/** Cluster dump: deployer or ≥2 distinct cabal-tagged wallets sent the token out within the last 10 min (and after entry). */
export function dumpSignal(txs: DTx[], mint: string, deployer: string | undefined, tagOf: (a: string) => string | undefined, openedAt = 0): { kind: "dump"; label: string } | null {
  const since = Math.max(Date.now() / 1000 - DUMP_WINDOW_SEC, openedAt / 1000);
  const cabal = new Set<string>(); let dep = false;
  for (const t of txs) {
    if (t.timestamp < since) continue;
    for (const x of t.tokenTransfers ?? []) {
      if (x.mint !== mint || !x.fromUserAccount) continue;
      if (deployer && x.fromUserAccount === deployer) dep = true;
      if (tagOf(x.fromUserAccount) === "cabal") cabal.add(x.fromUserAccount);
    }
  }
  if (dep) return { kind: "dump", label: "Cluster dump: deployer menjual (10 mnt)" };
  if (cabal.size >= 2) return { kind: "dump", label: `Cluster dump: ${cabal.size} wallet cabal menjual (10 mnt)` };
  return null;
}
/** Deployer guess: fee payer of the oldest tx, only trustworthy when the full history fits in one page. */
export const guessDeployer = (txs: (DTx & { feePayer?: string })[], limit = 100) => txs.length && txs.length < limit ? [...txs].sort((a, b) => a.timestamp - b.timestamp)[0]!.feePayer : undefined;

/** Pisces 8: a trigger wallet (holder that caused the entry) sold ≥25% of what it received, after entry. */
export function mirrorSignal(txs: DTx[], mint: string, triggers: string[] | undefined, openedAt = 0): { kind: "mirror"; label: string; wallets: string[] } | null {
  if (!triggers?.length) return null;
  const inA = new Map<string, number>(), outA = new Map<string, number>();
  for (const t of txs) for (const x of t.tokenTransfers ?? []) {
    if (x.mint !== mint) continue; const amt = Number(x.tokenAmount ?? 0);
    if (x.toUserAccount && triggers.includes(x.toUserAccount)) inA.set(x.toUserAccount, (inA.get(x.toUserAccount) ?? 0) + amt);
    if (triggers.includes(x.fromUserAccount) && t.timestamp * 1000 >= openedAt) outA.set(x.fromUserAccount, (outA.get(x.fromUserAccount) ?? 0) + amt);
  }
  const hit = triggers.filter((w) => (outA.get(w) ?? 0) > 0 && (outA.get(w) ?? 0) >= MIRROR_SELL * Math.max(inA.get(w) ?? 0, outA.get(w) ?? 0));
  return hit.length ? { kind: "mirror", label: `Exit mirroring: ${hit.length} wallet pemicu menjual ≥25%`, wallets: hit } : null;
}
