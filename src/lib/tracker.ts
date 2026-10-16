// Global paper-position tracker: polls real prices every 2s regardless of active page.
import { useSyncExternalStore } from "react";
import { bestPairs, jupPrices, solUsd } from "./real";
import { short } from "./sim";
import { getState, pushAlert, setState, type Position } from "./store";
import { exitDecision, suspiciousDrop, dumpSignal, guessDeployer, mirrorSignal } from "./exit-rules";
import { heliusRest } from "./helius";
import { heliusOn } from "./store";
import { liveCurvePx, startPriceStream } from "./price-stream";

export { SWAP_FEE as FEE } from "./edge";
import { proceedsSol } from "./edge";
export interface Quote { price: number; liq: number; src: "jupiter" | "dexscreener" | "stream"; at: number }
interface T { quotes: Record<string, Quote>; sol: number; updated: number; tick: number; error: string }

let t: T = { quotes: {}, sol: 0, updated: 0, tick: 0, error: "" };
const subs = new Set<() => void>();
const emit = (p: Partial<T>) => { t = { ...t, ...p }; subs.forEach((f) => f()); };
export const useTracker = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => t, () => t);

export function proceeds(p: Position, price: number, sol: number, liq: number, fraction = 1) {
  return proceedsSol(p.qty, price, sol, liq, fraction);
}

export function closePosition(p: Position, price: number, sol: number, liq: number, reason: string, fraction = 1) {
  const outSol = proceeds(p, price, sol, liq, fraction);
  const cost = p.sizeSol * fraction;
  setState((s) => {
    if (!s.positions.some((x) => x.id === p.id)) return {};
    const balance = s.balance + outSol;
    const positions = fraction >= 1 ? s.positions.filter((x) => x.id !== p.id)
      : s.positions.map((x) => x.id === p.id ? { ...x, qty: x.qty * (1 - fraction), sizeSol: x.sizeSol - cost, securedPrincipal: true } : x);
    const equity = [...s.equity, balance + positions.reduce((a, x) => a + x.sizeSol, 0)].slice(-200);
    return { balance, positions, equity, trades: [{ id: `${p.id}-${Date.now()}`, token: p.token, symbol: p.symbol, pnlSol: outSol - cost, roi: ((outSol - cost) / cost) * 100, closedAt: Date.now(), reason }, ...s.trades] };
  });
}

/** Current PnL % of a position (after fee & estimated sell impact) or null if no price. */
export function pnlPct(p: Position, q: Quote | undefined, sol: number) {
  if (!q || !sol) return null;
  return (proceeds(p, q.price, sol, q.liq) / p.sizeSol - 1) * 100;
}

let liqCache: Record<string, { liq: number; quoteSol: number; price: number; at: number }> = {};
const lastPx: Record<string, number> = {};
let busy = false;
const dumpAt: Record<string, number> = {};
type HTx = { timestamp: number; feePayer: string; tokenTransfers?: { fromUserAccount: string; toUserAccount?: string; mint: string; tokenAmount?: number }[] };
/** Dump-signal check, throttled to once per 30s per token to protect Helius quota. */
async function checkDump(p: Position, dump: boolean, mirror: boolean) {
  if (Date.now() - (dumpAt[p.token] ?? 0) < 30_000 || !heliusOn("signals")) return null;
  dumpAt[p.token] = Date.now();
  const txs = await heliusRest<HTx[]>(`/v0/addresses/${p.token}/transactions?limit=100`);
  if (!txs?.length) return null;
  const mem = getState().memory;
  if (mirror && !p.mirrored) { const m = mirrorSignal(txs, p.token, p.triggers, p.openedAt); if (m) return m; }
  if (!dump) return null;
  let dep = p.deployer ?? guessDeployer(txs);
  if (dep && !p.deployer) setState((y) => ({ positions: y.positions.map((z) => z.id === p.id ? { ...z, deployer: dep } : z) }));
  return dumpSignal(txs, p.token, dep, (a) => mem.find((m) => m.address === a)?.tag, p.openedAt);
}

export async function refreshNow() {
  if (busy) return; busy = true;
  try {
    const list = [...new Set(getState().positions.map((p) => p.token))];
    if (!list.length) { emit({ quotes: {} }); return; }
    // Liquidity rarely changes much; refresh DexScreener every 15s, Jupiter price every tick.
    const stale = list.filter((k) => !liqCache[k] || Date.now() - liqCache[k]!.at > 15_000);
    const [pairs, jp, sp] = await Promise.all([stale.length ? bestPairs(stale) : Promise.resolve(new Map()), jupPrices(list), solUsd()]);
    pairs.forEach((p, k) => { liqCache[k] = { liq: p.liquidity?.usd ?? 0, quoteSol: p.liquidity?.quote ?? 0, price: Number(p.priceUsd ?? 0), at: Date.now() }; });
    const syms = new Map<string, string>();
    pairs.forEach((p, k) => { const sy = (p as { baseToken?: { symbol?: string } }).baseToken?.symbol; if (sy) syms.set(k, sy); });
    if (syms.size && getState().positions.some((p) => !p.symbol && syms.has(p.token)))
      setState((y) => ({ positions: y.positions.map((z) => !z.symbol && syms.has(z.token) ? { ...z, symbol: syms.get(z.token) } : z) }));
    if (!sp) { emit({ error: "Harga SOL tidak tersedia" }); return; }
    const quotes: Record<string, Quote> = {};
    for (const k of list) {
      const c = liqCache[k];
      const liq = c ? (c.liq || c.quoteSol * sp * 2) : 0; // effective liquidity for Pump.fun curve pools
      const cp = liveCurvePx(k);
      if (cp && (!jp[k] || Math.abs((cp * sp) / jp[k]! - 1) < 0.5)) quotes[k] = { price: cp * sp, liq, src: "stream", at: Date.now() };
      else if (jp[k]) quotes[k] = { price: jp[k]!, liq, src: "jupiter", at: Date.now() };
      else if (c?.price) quotes[k] = { price: c.price, liq, src: "dexscreener", at: c.at };
    }
    emit({ quotes, sol: sp, updated: Date.now(), tick: t.tick + 1, error: "" });
    const st = getState();
    for (const p of st.positions) {
      const x = quotes[p.token]; if (!x) continue;
      const second = x.src === "jupiter" ? liqCache[p.token]?.price : jp[p.token];
      if (suspiciousDrop(lastPx[p.token], x.price, second)) continue; // thin-pool anomaly: skip this tick
      lastPx[p.token] = x.price;
      const ath = Math.max(p.ath, x.price);
      if (ath !== p.ath) setState((y) => ({ positions: y.positions.map((z) => z.id === p.id ? { ...z, ath } : z) }));
      let d: { kind: string; label: string } | null = exitDecision({ ...p, ath }, x.price, st.guard);
      const mir = st.guard.mirror && st.guard.mirror !== "off" ? st.guard.mirror : null;
      if (!d && (st.guard.dumpSignal || (mir && p.triggers?.length))) d = await checkDump(p, !!st.guard.dumpSignal, !!mir).catch(() => null);
      if (!d) continue;
      if (d.kind === "mirror") {
        setState((y) => ({ positions: y.positions.map((z) => z.id === p.id ? { ...z, mirrored: true } : z) }));
        if (mir === "half") closePosition(p, x.price, sp, x.liq, `${d.label} — jual 50%`, 0.5);
        pushAlert("dump", `🪞 ${p.symbol ?? short(p.token)}: ${d.label} → ${mir === "half" ? "50% dijual" : "trailing diketatkan −10%"}`);
        continue;
      }
      if (d.kind === "tp1") { closePosition(p, x.price, sp, x.liq, d.label, 0.5); pushAlert("info", `Paper: ${p.symbol ?? short(p.token)} ${d.label} — 50% sold`); }
      else closePosition(p, x.price, sp, x.liq, d.label);
    }
  } catch (e) { emit({ error: (e as Error).message }); }
  finally { busy = false; }
}

let started = false;
export function startTracker() {
  if (started || typeof window === "undefined") return; started = true;
  void refreshNow();
  startPriceStream(() => void refreshNow());
  setInterval(() => { if (getState().positions.length) void refreshNow(); }, 2000);
}
