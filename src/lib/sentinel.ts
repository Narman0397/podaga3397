import { fetchMint } from "./helius";
import { flowIntel, type FlowIntel, hasKeys, holderOwners, quote, bestPairs, SOL_MINT, solUsd, pricesUsd } from "./real";
import type { TokenMarket } from "./sim";
import { isDust, masterOf, walletScore, curvePctOf, TRACE_TTL } from "./edge";
import { liveBuys } from "./stream";
import { getState, setState, type Position } from "./store";

export type FeedStatus = "tierA" | "pending" | "tierB" | "quarantine" | "requalified" | "rejected";
export interface FeedToken {
  mint: string; symbol: string; bornAt: number;
  /** Top-10 holder concentration (%) from Helius; null when not verified. */
  clusterPct: number | null; initialClusterPct: number | null;
  vol5mUsd: number; buys5m: number; buySellRatio: number; indepBuyers: number;
  m: TokenMarket; status: FeedStatus; dexId?: string; verified: boolean;
  flags: { breakout: boolean; dump: boolean; highVol: boolean };
  /** Cross-reference of top-20 holders with the cluster memory DB. */
  intel: Intel;
}

export interface Intel {
  cabalPct: number; cabalWallets: number; watchPct: number; watchWallets: number; dust: number; rugger: boolean; organic: boolean; devDump: boolean;
  coordinated: boolean; earlyTagged: number; exits: number; repMax: number; fresh: number; lastInflowAt: number | null;
  mode: "bundle" | "dca" | null; bundleSec: number | null; masters: number; sameMaster: boolean; alpha: number; churner: number; triggers: string[];
}
/** Tier A requires on-chain verification. Healthy unverified tokens are "pending" (never silently quarantined). */
export function evaluate(t: Omit<FeedToken, "status">, prev?: FeedStatus): FeedStatus {
  const cap = getState().guard;
  if (t.verified && (t.m.mintAuthority || t.m.freezeAuthority)) return "rejected";
  if (t.intel.rugger || t.intel.devDump) return "quarantine";
  const clean = t.verified && t.clusterPct !== null && t.clusterPct < 15 && t.m.liquidityUsd >= cap.minLp;
  if (clean) return prev === "quarantine" ? "requalified" : "tierA";
  if ((prev === "quarantine" || prev === "requalified") && t.verified && t.clusterPct !== null && t.clusterPct < 10 && t.buySellRatio > 1.1) return "requalified";
  if (t.verified && t.flags.highVol) return "tierB";
  if (!t.verified && t.m.liquidityUsd >= cap.minLp && t.buySellRatio >= 1 && !t.flags.dump) return "pending";
  return "quarantine";
}

export const isPumpFun = (mint: string, dexId?: string) => mint.endsWith("pump") || dexId === "pumpfun" || dexId === "pumpswap";

/** Real Jito landed-tip recommendation is fetched via getJitoTip (market.functions). */

export async function detectKind(addr: string): Promise<"token" | "wallet"> {
  if (hasKeys()) return (await fetchMint(addr)) ? "token" : "wallet";
  const p = await pricesUsd([addr]);
  return p[addr] ? "token" : "wallet";
}

/** Paper buy at the real market price with real Jupiter price impact. */
/** Dynamic impact limit: liquid AMM uses guard.maxImpact, curve/microcap allows up to 8%. */
export async function impactLimit(mint: string): Promise<number> {
  const base = getState().guard.maxImpact;
  const p = (await bestPairs([mint]).catch(() => new Map())).get(mint) as { liquidity?: { usd?: number }; dexId?: string } | undefined;
  const liq = p?.liquidity?.usd ?? 0;
  return isPumpFun(mint, p?.dexId) || liq < 50_000 ? Math.max(base, 8) : base;
}

export async function paperBuy(mint: string, size: number, maxImpactArg?: number, symbolArg?: string, triggers?: string[]): Promise<string | null> {
  const s = getState();
  const maxImpact = maxImpactArg && maxImpactArg > 0 ? maxImpactArg : await impactLimit(mint);
  if (size <= 0 || size > s.balance) return "Saldo paper tidak cukup";
  const [px, sol, q, pairs] = await Promise.all([pricesUsd([mint]), solUsd(), quote(SOL_MINT, mint, size * 1e9), symbolArg ? Promise.resolve(null) : bestPairs([mint]).catch(() => null)]);
  const symbol = symbolArg || (pairs?.get(mint) as { baseToken?: { symbol?: string } } | undefined)?.baseToken?.symbol;
  const price = px[mint];
  if (!price || !sol) return "Harga real tidak tersedia untuk token ini";
  if (!q) return "Tidak ada rute swap (Jupiter) — token tidak bisa dibeli";
  if (q.impactPct > maxImpact) return `⛔ Ditolak guardrail: price impact ${q.impactPct.toFixed(2)}% > batas ${maxImpact}%. Kecilkan size atau naikkan Max impact.`;
  const fill = price * (1 + q.impactPct / 100);
  const qty = (size * sol) / fill;
  const p: Position = { id: `${Date.now()}`, token: mint, symbol, entry: fill, sizeSol: size, qty, ath: fill, securedPrincipal: false, openedAt: Date.now(), triggers: triggers?.length ? triggers : undefined };
  setState((x) => ({ balance: x.balance - size, positions: [p, ...x.positions] }));
  return null;
}

/* ---------------- Live feed (DexScreener public API + Helius verification) ---------------- */
interface DsPair {
  pairAddress: string; dexId: string; baseToken: { address: string; symbol: string };
  priceUsd?: string; liquidity?: { usd?: number; quote?: number }; marketCap?: number; fdv?: number;
  volume?: { m5?: number; h1?: number }; txns?: { m5?: { buys: number; sells: number }; h1?: { buys: number; sells: number } };
  pairCreatedAt?: number;
}

type Verify = { mintAuthority: string | null; freezeAuthority: string | null; conc: number | null; holders: { owner: string; pct: number }[]; flow: FlowIntel | null; at: number };
const verifyCache = new Map<string, Verify>();
const verifying = new Map<string, Promise<Verify | null>>();
let verifyBudget = 0; // lazy verification: new Helius checks allowed per Radar cycle
const forced = new Set<string>();
/** "Verify Now": run a Helius check immediately, bypassing the per-cycle budget. */
export async function verifyNow(mint: string): Promise<boolean> {
  if (!hasKeys()) return false;
  forced.add(mint); verifyCache.delete(mint);
  const r = await verify(mint, true, true);
  return !!r;
}
async function verify(mint: string, priority: boolean, force = false): Promise<Verify | null> {
  const c = verifyCache.get(mint);
  if (c && Date.now() - c.at < 120_000) return c;
  if (forced.has(mint)) { forced.delete(mint); force = true; }
  if (!hasKeys()) return c ?? null;
  const inflight = verifying.get(mint); if (inflight) return inflight;
  if (!force && (!priority || verifyBudget <= 0 || !heliusOn("radarVerify"))) return c ?? null; // keep stale result, verify later
  if (!force) verifyBudget--;
  const run = doVerify(mint).finally(() => verifying.delete(mint));
  verifying.set(mint, run);
  return run;
}
async function doVerify(mint: string): Promise<Verify | null> {
  const [info, holders, flow] = await Promise.all([fetchMint(mint), holderOwners(mint), flowIntel(mint, undefined, 1)]);
  if (!info) return null;
  const conc = holders ? +holders.slice(0, 10).reduce((a, h) => a + h.pct, 0).toFixed(2) : null;
  const v = { mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, conc, holders: holders ?? [], flow, at: Date.now() };
  verifyCache.set(mint, v);
  return v;
}

function crossRef(holders: { owner: string; pct: number }[], dump: boolean, flow: FlowIntel | null, mint: string, mcap: number, solPx: number): Intel {
  const mem = getState().memory;
  let cabalPct = 0, cabalWallets = 0, watchPct = 0, watchWallets = 0, dust = 0, rugger = false, repMax = 0, alpha = 0, churner = 0;
  const masters = new Set<string>(); const triggers: string[] = []; const counted = new Set<string>();
  for (const h of holders) {
    const t = mem.find((m) => m.address === h.owner); if (!t) continue;
    if (t.tag === "rugger") { rugger = true; continue; }
    if (isDust(h.pct, mcap, solPx)) { dust++; continue; }
    counted.add(h.owner); triggers.push(h.owner);
    if (t.tag === "cabal") { cabalWallets++; cabalPct += h.pct; } else { watchWallets++; watchPct += h.pct; }
    repMax = Math.max(repMax, walletScore(t));
    if (t.perf?.cls === "alpha") alpha++; else if (t.perf?.cls === "churner") churner++;
    const mo = masterOf(t); if (mo) masters.add(mo);
  }
  if (flow?.earlyRugger) rugger = true;
  const exits = flow?.exits.length ?? 0;
  const devDump = !!flow?.deployerDumped || exits >= 2 || (dump && (cabalWallets > 0 || rugger));
  const fresh = new Map<string, number>((flow?.fresh ?? []).map((f) => [f.wallet, f.at]));
  for (const b of liveBuys(mint)) fresh.set(b.wallet, Math.max(fresh.get(b.wallet) ?? 0, b.at));
  const freshAts = [...fresh.values()];
  const mode = flow?.bundle ? "bundle" : flow?.coordinated || freshAts.length >= 2 ? "dca" : null;
  return {
    cabalPct: +cabalPct.toFixed(2), cabalWallets, watchPct: +watchPct.toFixed(2), watchWallets, dust, rugger,
    organic: holders.length > 0 && cabalWallets + watchWallets === 0 && !rugger && (flow?.earlyTagged ?? 0) === 0, devDump,
    coordinated: !!flow?.coordinated, earlyTagged: flow?.earlyTagged ?? 0, exits, repMax, fresh: fresh.size,
    lastInflowAt: freshAts.length ? Math.max(...freshAts) : null, mode, bundleSec: flow?.bundle?.windowSec ?? null,
    masters: masters.size, sameMaster: counted.size >= 2 && masters.size === 1, alpha, churner, triggers: [...new Set([...triggers, ...fresh.keys()])].slice(0, 10),
  };
}

async function fromPair(p: DsPair, prev: FeedToken | undefined, priority: boolean, solPx: number): Promise<FeedToken> {
  const mint = p.baseToken.address;
  const liq = p.liquidity?.usd ?? 0;
  const mcap = p.marketCap ?? p.fdv ?? 0;
  const onCurve = p.dexId === "pumpfun";
  const solPooled = p.liquidity?.quote ?? 0;
  const curvePct = onCurve ? +curvePctOf(solPooled, mcap).toFixed(1) : 100;
  const t5 = p.txns?.m5 ?? { buys: 0, sells: 0 }; const t1 = p.txns?.h1 ?? { buys: 0, sells: 0 };
  const ratio = +((t5.buys + 1) / (t5.sells + 1)).toFixed(2);
  const vol = p.volume?.m5 ?? 0;
  const v = await verify(mint, priority);
  const dump = ratio < 0.5 && t5.sells > 20;
  const m: TokenMarket = {
    mint, symbol: p.baseToken.symbol, price: Number(p.priceUsd ?? 0), curvePct, migrated: !onCurve, liquidityUsd: liq,
    virtualSol: solPooled, virtualTokens: 0, mcap, sellTax: 0, honeypot: false,
    mintAuthority: v?.mintAuthority ?? null, freezeAuthority: v?.freezeAuthority ?? null,
  };
  const clusterPct = v?.conc ?? null;
  const base = {
    mint, symbol: p.baseToken.symbol, bornAt: p.pairCreatedAt ?? Date.now(), clusterPct, verified: !!v,
    initialClusterPct: prev?.initialClusterPct ?? clusterPct, vol5mUsd: vol, buys5m: t5.buys, buySellRatio: ratio, indepBuyers: t1.buys, m,
    flags: { breakout: vol > 100_000, dump, highVol: vol > 20_000 && ratio > 1.1 },
    intel: crossRef(v?.holders ?? [], dump, v?.flow ?? null, mint, mcap, solPx),
  };
  return { ...base, dexId: p.dexId, status: evaluate(base, prev?.status) };
}

export async function fetchLiveFeed(prev: FeedToken[] = [], onFast?: (fast: FeedToken[]) => void): Promise<FeedToken[]> {
  const lists = await Promise.all([
    fetch("https://api.dexscreener.com/token-profiles/latest/v1").then((r) => r.json()).catch(() => []),
    fetch("https://api.dexscreener.com/token-boosts/latest/v1").then((r) => r.json()).catch(() => []),
    fetch("https://api.dexscreener.com/token-boosts/top/v1").then((r) => r.json()).catch(() => []),
  ]);
  // Auto-purge dead tokens from the carried-over buffer.
  prev = prev.filter((p) => p.vol5mUsd > 0 && p.m.liquidityUsd >= 1000);
  const addrs = [...new Set([...lists.flat().filter((x: { chainId: string }) => x?.chainId === "solana").map((x: { tokenAddress: string }) => x.tokenAddress), ...prev.map((p) => p.mint)])].slice(0, 60);
  if (!addrs.length) return prev;
  const chunks = [addrs.slice(0, 30), addrs.slice(30)].filter((c) => c.length);
  const res = (await Promise.all(chunks.map((c) => fetch(`https://api.dexscreener.com/tokens/v1/solana/${c.join(",")}`).then((r) => r.json()).catch(() => [])))).flat();
  const best = new Map<string, DsPair>();
  for (const p of (res as DsPair[]) ?? []) {
    const k = p.baseToken?.address; if (!k || !addrs.includes(k)) continue;
    if (!best.has(k) || (p.liquidity?.usd ?? 0) > (best.get(k)!.liquidity?.usd ?? 0)) best.set(k, p);
  }
  const pm = new Map(prev.map((p) => [p.mint, p]));
  // Prioritise the most active tokens for Helius verification (max 8 new checks per cycle).
  verifyBudget = 8;
  const ranked = [...best.values()].sort((a, b) => (b.volume?.m5 ?? 0) - (a.volume?.m5 ?? 0));
  const top = new Set(ranked.slice(0, 15).map((p) => p.baseToken.address));
  const solPx = await solUsd();
  const keep = (l: FeedToken[]) => l.filter((t) => t.vol5mUsd > 0 || Date.now() - t.bornAt < 10 * 60_000).sort((a, b) => b.bornAt - a.bornAt);
  // Progressive render: emit DexScreener data + cached verification instantly, then verify in the background.
  if (onFast) onFast(keep(await Promise.all(ranked.map((p) => fromPair(p, pm.get(p.baseToken.address), false, solPx)))));
  const out = await Promise.all(ranked.map((p) => fromPair(p, pm.get(p.baseToken.address), top.has(p.baseToken.address), solPx)));
  return keep(out);
}

/* ---------------- Background selective deep trace (Tier A / Tier B only) ---------------- */
import { traceReverse } from "./real";
import { autoSaveCluster, heliusOn, pushAlert as _push, DEFAULT_HELIUS, clampSlots } from "./store";
const traced = new Map<string, number>(); // mint -> last trace time
let tracing = false;
export const autoTraceStats = { queued: 0, done: 0, saved: 0, current: "" as string, slotsGeneral: 2, slotsPump: 1 };
const isPumpTrack = (t: FeedToken) => isPreRaydium(t);
/** Dual-track deep trace: Track 1 DEX/Raydium (A/B/Pending/Quarantine) + Track 2 Pre-Raydium Pump.fun, each with its own slot quota. */
export async function autoTraceTiers(feed: FeedToken[]) {
  const hs = { ...DEFAULT_HELIUS, ...getState().helius };
  const nGen = clampSlots(hs.traceSlotsGeneral, 2), nPump = clampSlots(hs.traceSlotsPumpFun, 1);
  autoTraceStats.slotsGeneral = nGen; autoTraceStats.slotsPump = nPump;
  if (tracing || !hasKeys() || !getState().autoSaveCluster || !heliusOn("radarAutoTrace") || nGen + nPump === 0) return;
  const now = Date.now();
  const fresh = feed.filter((t) => t.status !== "rejected" && !t.m.mintAuthority && !t.m.freezeAuthority && now - (traced.get(t.mint) ?? 0) > TRACE_TTL);
  const general = fresh.filter((t) => !isPumpTrack(t) && t.vol5mUsd > 0).sort((a, b) => b.vol5mUsd - a.vol5mUsd).slice(0, nGen);
  const pump = fresh.filter((t) => isPumpTrack(t) && (t.m.curvePct >= 15 || t.vol5mUsd >= 1000)).sort((a, b) => b.vol5mUsd - a.vol5mUsd).slice(0, nPump);
  const todo = [...general.map((t) => ({ t, pf: false })), ...pump.map((t) => ({ t, pf: true }))];
  autoTraceStats.queued = todo.length;
  if (!todo.length) return;
  tracing = true;
  try {
    for (const { t, pf } of todo) {
      autoTraceStats.current = pf ? `$${t.symbol} (Pump.fun curve ${t.m.curvePct}%)` : `$${t.symbol} (${LBL[t.status]})`;
      traced.set(t.mint, Date.now());
      try {
        const c = await traceReverse(t.mint, { pumpCurve: pf });
        const n = autoSaveCluster(c, t.mint, pf ? { symbol: t.symbol, curvePct: t.m.curvePct } : undefined);
        autoTraceStats.done++; autoTraceStats.saved += n;
        if (n > 0) _push("info", `🧬 Auto-trace ${t.symbol} [${pf ? "Pump.fun" : LBL[t.status]}]: ${n} wallet cluster tersimpan`);
      } catch { /* rate limit / error: retry after TTL */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally { tracing = false; autoTraceStats.current = ""; autoTraceStats.queued = 0; }
}

const LBL: Record<FeedStatus, string> = { tierA: "Tier A", requalified: "Requalified", tierB: "Tier B", pending: "Pending", quarantine: "Quarantine", rejected: "Rejected" };

/* ---------------- Pre-Raydium Pump.fun Gems + AutoBuy ---------------- */
import { DEFAULT_AUTOBUY } from "./store";
import { tokenEdgeScore, goldenSetup } from "./edge";
export const isPreRaydium = (t: FeedToken) => isPumpFun(t.mint, t.dexId) && !t.m.migrated && t.m.curvePct < 100;
export const hasElite = (t: FeedToken) => t.intel.cabalWallets > 0 || t.intel.watchWallets >= 3 || t.intel.earlyTagged > 0 || t.intel.coordinated;

/** Which AutoBuy checks a token passes. Entry triggers (any) + filters (all checked must pass). */
export function autoBuyChecks(t: FeedToken) {
  const c = { ...DEFAULT_AUTOBUY, ...getState().autoBuy };
  const hit = {
    onBreakout: t.vol5mUsd > 20_000 && t.buySellRatio > 1.3,
    // Pisces 1+3: ≥1 verified cabal or ≥3 watch wallets AND a fresh buy ≤15m; churner-led entries are skipped.
    onCabalInflow: (t.intel.cabalWallets >= 1 || t.intel.watchWallets >= 3) && t.intel.fresh > 0 && t.intel.churner <= t.intel.alpha,
    onVolumeSurge: t.buySellRatio >= 1.5,
    onCurveSweetSpot: t.m.curvePct >= c.curveMin && t.m.curvePct <= c.curveMax,
    onSafeOrganic: t.clusterPct !== null && t.clusterPct < 15 && !t.intel.rugger && !t.intel.devDump && t.intel.exits === 0,
  };
  const f = {
    fMinLiq: t.m.liquidityUsd >= c.minLiqUsd,
    fMcap: t.m.mcap >= c.mcapMin && t.m.mcap <= c.mcapMax,
    fMinBuys: t.buys5m >= c.minBuys5m,
    fMaxAge: Date.now() - t.bornAt <= c.maxAgeMin * 60_000,
    fMaxTop10: t.clusterPct !== null && t.clusterPct <= c.maxTop10,
  };
  Object.assign(hit, f);
  const extra = (Object.keys(f) as (keyof typeof f)[]).filter((k) => c[k]);
  const triggers = (["onBreakout", "onCabalInflow", "onVolumeSurge"] as const).filter((k) => c[k]);
  const filters = (["onCurveSweetSpot", "onSafeOrganic"] as const).filter((k) => c[k]);
  const ok = triggers.length > 0 && triggers.some((k) => hit[k]) && filters.every((k) => hit[k]) && extra.every((k) => f[k]) && !t.intel.rugger && !t.intel.devDump && !t.flags.dump;
  const g = getState().guard; const score = tokenEdgeScore(t.intel, t.clusterPct);
  const gateOk = !g.scoreGate || score >= (g.minScore ?? 60);
  const golden = goldenSetup(t.intel, score);
  const tagOk = c.tagGate === false || golden.ok;
  return { hit, ok: ok && gateOk && tagOk, score, gateOk, golden };
}

let buying = false;
/** Evaluate every Pre-Raydium token on each feed cycle and paper-buy the ones that pass, within guardrails. */
export async function runAutoBuy(feed: FeedToken[]) {
  const c = { ...DEFAULT_AUTOBUY, ...getState().autoBuy };
  if (!c.enabled || buying) return;
  buying = true;
  try {
    for (const t of feed.filter(isPreRaydium)) {
      const s = getState();
      if (c.cabalOnly && !hasElite(t)) continue;
      if (s.positions.length >= c.maxOpen || s.balance < c.sizeSol) break;
      if (s.positions.some((p) => p.token === t.mint)) continue;
      if (Date.now() - (s.autoBuyLog[t.mint] ?? 0) < c.cooldownMin * 60_000) continue;
      if (!autoBuyChecks(t).ok) continue;
      setState((x) => ({ autoBuyLog: { ...Object.fromEntries(Object.entries(x.autoBuyLog).filter(([, v]) => Date.now() - v < 86_400_000)), [t.mint]: Date.now() } }));
      const err = await paperBuy(t.mint, c.sizeSol, 8, t.symbol, t.intel.triggers);
      _push(err ? "risk" : "buy", err ? `AutoBuy ${t.symbol} gagal: ${err}` : `🤖 AutoBuy ${c.sizeSol} SOL $${t.symbol} (curve ${t.m.curvePct}%)`);
    }
  } finally { buying = false; }
}
