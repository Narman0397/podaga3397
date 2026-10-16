// Live position pricing: Helius WebSocket accountSubscribe on each open position's pool (browser, while the app is open).
import { useSyncExternalStore } from "react";
import { bestPairs } from "./real";
import { getState, heliusOn } from "./store";

const livePx = new Map<string, { solPerToken: number; at: number }>();
/** Exact SOL/token price decoded from a Pump.fun bonding curve push, if fresh (<5s). */
export const liveCurvePx = (mint: string) => { const v = livePx.get(mint); return v && Date.now() - v.at < 5_000 ? v.solPerToken : 0; };

let snap = { connected: false, pools: 0, pushes: 0, lastAt: 0 };
const subs = new Set<() => void>();
const emit = (p: Partial<typeof snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };
export const usePriceStream = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => snap, () => snap);

let ws: WebSocket | null = null; let key = ""; let watched = "";
const reqMap = new Map<number, string>(); const subMap = new Map<number, { mint: string; curve: boolean }>();
const pools = new Map<string, { addr: string; curve: boolean }>();
let onPush: () => void = () => {};

/** Pump.fun curve layout: 8B discriminator, virtualTokenReserves u64 @8, virtualSolReserves u64 @16 (6 / 9 decimals). */
function decodeCurve(b64: string) {
  const bin = atob(b64); if (bin.length < 24) return 0;
  const u64 = (o: number) => { let v = 0; for (let i = 7; i >= 0; i--) v = v * 256 + bin.charCodeAt(o + i); return v; };
  const tok = u64(8) / 1e6, sol = u64(16) / 1e9;
  return tok > 0 && sol > 0 ? sol / tok : 0;
}

function close() { try { ws?.close(); } catch { /* ignore */ } ws = null; reqMap.clear(); subMap.clear(); emit({ connected: false, pools: 0 }); }

function open(k: string, list: { mint: string; addr: string; curve: boolean }[]) {
  close(); key = k; watched = list.map((x) => x.addr).join();
  const s = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${k}`); ws = s;
  s.onopen = () => {
    list.forEach((x, i) => { reqMap.set(i + 1, x.mint); s.send(JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "accountSubscribe", params: [x.addr, { encoding: "base64", commitment: "processed" }] })); });
    emit({ connected: true, pools: list.length });
  };
  s.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: number; method?: string; params?: { subscription: number; result: { value: { data: [string, string] } } } };
    if (m.id && typeof m.result === "number") { const mint = reqMap.get(m.id); const p = mint ? pools.get(mint) : null; if (mint && p) subMap.set(m.result, { mint, curve: p.curve }); return; }
    if (m.method !== "accountNotification" || !m.params) return;
    const t = subMap.get(m.params.subscription); if (!t) return;
    if (t.curve) { const px = decodeCurve(m.params.result.value.data[0]); if (px) livePx.set(t.mint, { solPerToken: px, at: Date.now() }); }
    emit({ pushes: snap.pushes + 1, lastAt: Date.now() });
    onPush();
  };
  s.onclose = () => { if (ws === s) { ws = null; emit({ connected: false }); } };
}

let started = false;
/** Syncs subscriptions with open positions every 10s; each pool push calls `refresh` (debounced 250ms). */
export function startPriceStream(refresh: () => void) {
  if (started || typeof window === "undefined") return; started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  onPush = () => { if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, 250); };
  const tick = async () => {
    const k = getState().keys.find((x) => x.status === "active")?.key;
    const mints = [...new Set(getState().positions.map((p) => p.token))];
    if (!heliusOn("priceStream") || !k || !mints.length) { if (ws) close(); return; }
    const missing = mints.filter((m) => !pools.has(m));
    if (missing.length) {
      const pairs = await bestPairs(missing).catch(() => new Map());
      pairs.forEach((p, m) => { const addr = (p as { pairAddress?: string }).pairAddress; if (addr) pools.set(m, { addr, curve: p.dexId === "pumpfun" }); });
    }
    const list = mints.flatMap((m) => { const p = pools.get(m); return p ? [{ mint: m, ...p }] : []; });
    if (!list.length) { if (ws) close(); return; }
    if (!ws || k !== key || list.map((x) => x.addr).join() !== watched) open(k, list);
  };
  void tick(); setInterval(() => void tick(), 10_000);
  setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" })); }, 45_000);
}
