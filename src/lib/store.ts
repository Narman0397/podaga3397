import { CEX_HOT_WALLETS, type WalletPerf } from "./edge";
import { useSyncExternalStore } from "react";

export type KeyStatus = "active" | "cooldown" | "depleted" | "empty";
export interface ApiKey { key: string; status: KeyStatus; cooldownUntil: number; calls: number; fails: number; /** Why a key is depleted: monthly quota used up vs invalid/unauthorized. */ reason?: "quota" | "invalid" | undefined }
export interface MemoryEntry { address: string; tag: "rugger" | "cabal" | "watch"; note: string; seen: number; at: number; perf?: WalletPerf | null }
export interface Position { id: string; token: string; symbol?: string | undefined; entry: number; sizeSol: number; qty: number; ath: number; securedPrincipal: boolean; openedAt: number; deployer?: string | undefined; triggers?: string[] | undefined; mirrored?: boolean | undefined }
export interface Trade { id: string; token: string; symbol?: string | undefined; pnlSol: number; roi: number; closedAt: number; reason: string }
export interface AlertEvent { id: string; kind: "buy" | "dump" | "migration" | "risk" | "info"; text: string; at: number }

export interface ScanEntry { address: string; kind: "token" | "wallet"; summary: string; at: number }
export type AlertTier = "A" | "B" | "breakout";

export interface State {
  scanHistory: ScanEntry[];
  alertFilter: { A: boolean; B: boolean; breakout: boolean };
  keys: ApiKey[];
  rotation: "round-robin" | "fallback";
  cursor: number;
  webhookUrl: string;
  blacklist: string[];
  memory: MemoryEntry[];
  balance: number;
  positions: Position[];
  trades: Trade[];
  equity: number[];
  telegram: { token: string; chatId: string; enabled: boolean };
  discord: { url: string; enabled: boolean };
  alerts: AlertEvent[];
  guard: { clusterCap: number; minLp: number; maxImpact: number; tp1: number; trail: number; graceSec?: number; trailArm?: number; initStop?: number; breakeven?: boolean; dumpSignal?: boolean; scoreGate?: boolean; minScore?: number; mirror?: "off" | "tighten" | "half" };
  autoSaveCluster: boolean;
  helius: HeliusModules;
  autoBuy: AutoBuyConfig;
  autoBuyLog: Record<string, number>;
}
export interface AutoBuyConfig { enabled: boolean; background24x7: boolean; onBreakout: boolean; onCabalInflow: boolean; onCurveSweetSpot: boolean; onSafeOrganic: boolean; onVolumeSurge: boolean; sizeSol: number; maxOpen: number; cooldownMin: number; curveMin: number; curveMax: number; cabalOnly: boolean; fMinLiq: boolean; minLiqUsd: number; fMcap: boolean; mcapMin: number; mcapMax: number; fMinBuys: boolean; minBuys5m: number; fMaxAge: boolean; maxAgeMin: number; fMaxTop10: boolean; maxTop10: number; tagGate?: boolean }
export const DEFAULT_AUTOBUY: AutoBuyConfig = { enabled: false, background24x7: false, onBreakout: true, onCabalInflow: true, onCurveSweetSpot: true, onSafeOrganic: false, onVolumeSurge: false, sizeSol: 0.2, maxOpen: 3, cooldownMin: 15, curveMin: 25, curveMax: 80, cabalOnly: true, fMinLiq: false, minLiqUsd: 8000, fMcap: false, mcapMin: 8000, mcapMax: 60000, fMinBuys: false, minBuys5m: 15, fMaxAge: false, maxAgeMin: 60, fMaxTop10: false, maxTop10: 25, tagGate: true };
export interface HeliusModules { master: boolean; radarVerify: boolean; radarAutoTrace: boolean; scannerTrace: boolean; scannerDeep: boolean; signals: boolean; worker: boolean; scanInterval?: number; traceSlotsGeneral?: number; traceSlotsPumpFun?: number; stream?: boolean; priceStream?: boolean; dailyTopVolume?: boolean; alphaHunter?: boolean }
export const DEFAULT_HELIUS: HeliusModules = { master: true, radarVerify: true, radarAutoTrace: true, scannerTrace: true, scannerDeep: true, signals: true, worker: true, scanInterval: 5, traceSlotsGeneral: 2, traceSlotsPumpFun: 1, stream: false, priceStream: false, dailyTopVolume: true, alphaHunter: true };
export const TRACE_SLOTS = [0, 1, 2, 3, 4, 5];
export const clampSlots = (n: unknown, d: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(5, Math.max(0, Math.round(v))) : d; };
export const SCAN_INTERVALS = [1, 2, 3, 5, 10, 15, 30];
export type HeliusToggle = Exclude<keyof HeliusModules, "scanInterval" | "traceSlotsGeneral" | "traceSlotsPumpFun">;
export function heliusOn(m: Exclude<HeliusToggle, "master">) { const h = { ...DEFAULT_HELIUS, ...getState().helius }; return h.master && h[m]; }

const DEFAULT_BLACKLIST = [
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9|Binance Hot 1",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM|Binance Hot 2",
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2|Bybit Hot",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS|Coinbase",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5|Kraken",
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ|OKX",
  "DiSPerSE111111111111111111111111111111111111|Disperse Contract",
];

const initial = (): State => ({
  scanHistory: [],
  alertFilter: { A: true, B: true, breakout: true },
  keys: Array.from({ length: 20 }, () => ({ key: "", status: "empty", cooldownUntil: 0, calls: 0, fails: 0 })),
  rotation: "round-robin",
  cursor: 0,
  webhookUrl: "",
  blacklist: DEFAULT_BLACKLIST,
  memory: [],
  balance: 10,
  positions: [],
  trades: [],
  equity: [10],
  telegram: { token: "", chatId: "", enabled: false },
  discord: { url: "", enabled: false },
  alerts: [],
  guard: { clusterCap: 20, minLp: 15000, maxImpact: 3, tp1: 100, trail: 25 },
  autoSaveCluster: true,
  helius: DEFAULT_HELIUS,
  autoBuy: DEFAULT_AUTOBUY,
  autoBuyLog: {},
});

const LS = "sol-intel-v1";
let state: State = initial();
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(LS);
    if (raw) state = { ...initial(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
}

export function getState() { load(); return state; }
export function subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
export function setState(fn: (s: State) => Partial<State>) {
  load();
  const next = fn(state);
  if (next.memory) {
    const addresses = new Set(next.memory.map((m) => m.address));
    next.memory = [...next.memory, ...state.memory.filter((m) => !addresses.has(m.address))];
  }
  state = { ...state, ...next };
  if (typeof window !== "undefined") localStorage.setItem(LS, JSON.stringify(state));
  subs.forEach((s) => s());
}
/** Resets volatile data only; Cluster Memory, Helius keys and settings are permanent account assets. */
export function resetState() {
  const i = initial();
  setState(() => ({ balance: i.balance, positions: [], trades: [], equity: i.equity, alerts: [], scanHistory: [] }));
}

const serverSnap = initial();
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => { load(); return sel(state); },
    () => sel(serverSnap),
  );
}

export function pushAlert(kind: AlertEvent["kind"], text: string, tier?: AlertTier) {
  const ev: AlertEvent = { id: `${Date.now()}-${Math.floor(performance.now())}`, kind, text, at: Date.now() };
  setState((s) => ({ alerts: [ev, ...s.alerts].slice(0, 100) }));
  if (!tier || state.alertFilter[tier]) void deliver(ev);
}

export function recordScan(e: Omit<ScanEntry, "at">) {
  setState((s) => ({ scanHistory: [{ ...e, at: Date.now() }, ...s.scanHistory.filter((x) => x.address !== e.address)].slice(0, 50) }));
}

async function deliver(ev: AlertEvent) {
  const { telegram, discord } = state;
  const msg = `[${ev.kind.toUpperCase()}] ${ev.text}`;
  try {
    if (telegram.enabled && telegram.token && telegram.chatId)
      await fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: telegram.chatId, text: msg }),
      });
    if (discord.enabled && discord.url)
      await fetch(discord.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: msg }) });
  } catch { /* delivery failures are non-fatal */ }
}

export function blacklistLabel(addr: string): string | null {
  const hit = state.blacklist.find((b) => b.split("|")[0] === addr);
  return hit ? hit.split("|")[1] ?? "Blacklisted" : null;
}
export function memoryTag(addr: string) { return state.memory.find((m) => m.address === addr); }

export const isAutoTag = (m: MemoryEntry) => m.note.startsWith("Auto:");
/** Save every wallet of a discovered cluster; never overrides manual tags. */
export function autoSaveCluster(c: { root: string; nodes: { id: string; level: number }[]; bundleScore: number; totalSupplyPct: number }, via: string, pump?: { symbol: string; curvePct: number }) {
  if (!state.autoSaveCluster || c.nodes.length === 0) return 0;
  const master = c.nodes.find((n) => n.level === 0)?.id;
  const now = Date.now();
  const add: MemoryEntry[] = [];
  for (const n of c.nodes) {
    if (blacklistLabel(n.id) || CEX_HOT_WALLETS[n.id]) continue;
    const ex = state.memory.find((m) => m.address === n.id);
    if (ex && !isAutoTag(ex)) continue;
    const tag: MemoryEntry["tag"] = n.level === 0 ? (c.bundleScore > 70 || c.totalSupplyPct > 20 ? "rugger" : "watch") : (c.bundleScore >= 60 ? "cabal" : "watch");
    const note = pump
      ? (n.level === 0 ? `Auto: Pump.fun Bundler master via $${pump.symbol}… (curve ${pump.curvePct}%, bundle ${c.bundleScore}) [Pump.fun Auto-Trace]` : `Auto: Pump.fun Bundler via $${pump.symbol}… (curve ${pump.curvePct}%) [Pump.fun Auto-Trace]`)
      : n.level === 0 ? `Auto: Master funder via ${via.slice(0, 6)}… (bundle ${c.bundleScore}, cluster ${c.totalSupplyPct}%)` : `Auto: L${n.level} sub-wallet of ${master?.slice(0, 6)}… via ${via.slice(0, 6)}…`;
    const seen = (ex?.seen ?? 0) + 1;
    add.push({ address: n.id, tag: tag === "watch" && seen >= 3 ? "cabal" : tag, note, seen, at: now });
  }
  if (add.length) setState((s) => ({ memory: [...add, ...s.memory.filter((m) => !add.some((a) => a.address === m.address))] }));
  return add.length;
}
