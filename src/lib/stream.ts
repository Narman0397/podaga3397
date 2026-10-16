// Pisces 7: real-time Helius WebSocket stream on top cabal wallets (browser, while the app is open).
import { useSyncExternalStore } from "react";
import { heliusRpc } from "./helius";
import { getState, heliusOn, pushAlert } from "./store";

const MAX_WALLETS = 60;
const BUY_TTL = 15 * 60_000;
const buys = new Map<string, { wallet: string; at: number }[]>();
/** Fresh buys of a mint seen live by the stream within the last 15 min. */
export const liveBuys = (mint: string) => (buys.get(mint) ?? []).filter((b) => Date.now() - b.at < BUY_TTL);

type Ev = { wallet: string; mint: string; side: "buy" | "sell"; at: number; sig: string };
let snap = { connected: false, wallets: 0, events: [] as Ev[] };
const subs = new Set<() => void>();
const emit = (p: Partial<typeof snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };
export const useStream = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => snap, () => snap);

let ws: WebSocket | null = null; let key = ""; let watched: string[] = [];
const subMap = new Map<number, string>(); const reqMap = new Map<number, string>();
const seenSig = new Set<string>();

function targets() {
  return getState().memory.filter((m) => m.tag === "cabal").sort((a, b) => (b.perf?.cls === "alpha" ? 1 : 0) - (a.perf?.cls === "alpha" ? 1 : 0) || b.seen - a.seen).slice(0, MAX_WALLETS).map((m) => m.address);
}

type PTx = { meta: { preTokenBalances?: { owner?: string; mint: string; uiTokenAmount: { uiAmount: number | null } }[]; postTokenBalances?: { owner?: string; mint: string; uiTokenAmount: { uiAmount: number | null } }[] } | null };
async function inspect(wallet: string, sig: string) {
  if (seenSig.has(sig)) return; seenSig.add(sig); if (seenSig.size > 2000) seenSig.clear();
  const tx = await heliusRpc<PTx>("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  const pre = tx?.meta?.preTokenBalances ?? [], post = tx?.meta?.postTokenBalances ?? [];
  const mints = new Set([...pre, ...post].filter((b) => b.owner === wallet).map((b) => b.mint));
  for (const mint of mints) {
    if (mint === "So11111111111111111111111111111111111111112") continue;
    const a = pre.find((b) => b.owner === wallet && b.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
    const b = post.find((x) => x.owner === wallet && x.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
    if (a === b) continue;
    const side: Ev["side"] = b > a ? "buy" : "sell"; const at = Date.now();
    if (side === "buy") buys.set(mint, [...liveBuys(mint).filter((x) => x.wallet !== wallet), { wallet, at }]);
    emit({ events: [{ wallet, mint, side, at, sig }, ...snap.events].slice(0, 50) });
    pushAlert(side === "buy" ? "buy" : "dump", `📡 Live: Kandidat Cabal ${wallet.slice(0, 4)}…${wallet.slice(-4)} ${side === "buy" ? "BELI" : "JUAL"} ${mint.slice(0, 4)}…${mint.slice(-4)}`, side === "buy" ? "B" : undefined);
  }
}

function close() { try { ws?.close(); } catch { /* ignore */ } ws = null; subMap.clear(); reqMap.clear(); emit({ connected: false, wallets: 0 }); }

function open(k: string, list: string[]) {
  close(); key = k; watched = list;
  const s = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${k}`); ws = s;
  s.onopen = () => {
    list.forEach((addr, i) => { reqMap.set(i + 1, addr); s.send(JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "logsSubscribe", params: [{ mentions: [addr] }, { commitment: "confirmed" }] })); });
    emit({ connected: true, wallets: list.length });
  };
  s.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: number; method?: string; params?: { subscription: number; result: { value: { signature: string; err: unknown } } } };
    if (m.id && typeof m.result === "number") { const a = reqMap.get(m.id); if (a) subMap.set(m.result, a); return; }
    if (m.method === "logsNotification" && m.params && !m.params.result.value.err) {
      const w = subMap.get(m.params.subscription); if (w) void inspect(w, m.params.result.value.signature).catch(() => {});
    }
  };
  s.onclose = () => { if (ws === s) { ws = null; emit({ connected: false }); } };
}

let started = false;
/** Keeps the stream in sync with the "Live stream" toggle and the cabal list; checks every 30s, reconnects on drop. */
export function startCabalStream() {
  if (started || typeof window === "undefined") return; started = true;
  const tick = () => {
    const k = getState().keys.find((x) => x.status === "active")?.key;
    if (!heliusOn("stream") || !k) { if (ws) close(); return; }
    const list = targets();
    if (!list.length) { if (ws) close(); return; }
    if (!ws || k !== key || list.join() !== watched.join()) open(k, list);
  };
  tick(); setInterval(tick, 30_000);
  setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" })); }, 45_000);
}
