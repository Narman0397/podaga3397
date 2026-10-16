import { getState, setState, type ApiKey, DEFAULT_HELIUS } from "./store";
const paused = () => !({ ...DEFAULT_HELIUS, ...getState().helius }).master;

const COOLDOWN_MS = 60_000;

/* Global limiter: max 4 concurrent Helius requests, >=100ms spacing between starts. */
const MAX_CONC = 4, GAP_MS = 100;
let active = 0, lastStart = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  while (active >= MAX_CONC) await new Promise<void>((r) => waiters.push(r));
  active++;
  const wait = Math.max(0, lastStart + GAP_MS - Date.now());
  lastStart = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}
function release() { active--; waiters.shift()?.(); }
async function limited(url: string, init?: RequestInit) { if (paused()) throw new Error("Helius paused"); await acquire(); try { return await fetch(url, init); } finally { release(); } }
/** Dedupe identical in-flight calls. */
const inflight = new Map<string, Promise<unknown>>();
function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const ex = inflight.get(key) as Promise<T> | undefined; if (ex) return ex;
  const p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); return p;
}

export function refreshKeyHealth() {
  const now = Date.now();
  setState((s) => ({
    keys: s.keys.map((k) =>
      k.status === "cooldown" && k.cooldownUntil <= now ? { ...k, status: "active" } : k,
    ),
  }));
}

function pickKey(): number {
  const { keys, cursor, rotation } = getState();
  const n = keys.length;
  const start = rotation === "round-robin" ? cursor : 0;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (keys[idx]?.status === "active") return idx;
  }
  return -1;
}

function patchKey(idx: number, p: Partial<ApiKey>) {
  setState((s) => ({ keys: s.keys.map((k, i) => (i === idx ? { ...k, ...p } : k)) }));
}

/** "max usage reached" = monthly quota gone (permanent until replaced); otherwise a short per-second rate limit. */
export const isQuotaMsg = (t: string) => /max usage|usage limit|credits? (exhausted|exceeded)/i.test(t);
async function on429(idx: number, k: ApiKey, res: Response) {
  const t = await res.text().catch(() => "");
  patchKey(idx, isQuotaMsg(t) ? { status: "depleted", reason: "quota", fails: k.fails + 1 } : { status: "cooldown", cooldownUntil: Date.now() + COOLDOWN_MS, fails: k.fails + 1 });
}

/** JSON-RPC call through the rotating Helius pool. Returns null when no key is usable. */
export function heliusRpc<T = unknown>(method: string, params: unknown[]): Promise<T | null> {
  return dedupe(`rpc:${method}:${JSON.stringify(params)}`, () => rpcRaw<T>(method, params));
}
async function rpcRaw<T>(method: string, params: unknown[]): Promise<T | null> {
  refreshKeyHealth();
  for (let attempt = 0; attempt < 20; attempt++) {
    const idx = pickKey();
    if (idx < 0) return null;
    const k = getState().keys[idx]!;
    setState((s) => ({ cursor: (idx + 1) % s.keys.length }));
    try {
      const res = await limited(`https://mainnet.helius-rpc.com/?api-key=${k.key}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429) { await on429(idx, k, res); continue; }
      if (res.status === 401 || res.status === 403) { patchKey(idx, { status: "depleted", reason: "invalid", fails: k.fails + 1 }); continue; }
      const j = await res.json();
      patchKey(idx, { calls: k.calls + 1 });
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch {
      patchKey(idx, { fails: k.fails + 1 });
    }
  }
  return null;
}

export interface MintInfo { mintAuthority: string | null; freezeAuthority: string | null; supply: string; decimals: number; live: boolean }

export async function fetchMint(mint: string): Promise<MintInfo | null> {
  type R = { value: { data: { parsed: { info: MintInfo } } } | null };
  const r = await heliusRpc<R>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = r?.value?.data?.parsed?.info;
  return info ? { ...info, live: true } : null;
}

/** Helius REST (Enhanced API) through the same rotating pool. */
export function heliusRest<T = unknown>(path: string): Promise<T | null> {
  return dedupe(`rest:${path}`, () => restRaw<T>(path));
}
async function restRaw<T>(path: string): Promise<T | null> {
  refreshKeyHealth();
  for (let attempt = 0; attempt < 20; attempt++) {
    const idx = pickKey();
    if (idx < 0) return null;
    const k = getState().keys[idx]!;
    setState((s) => ({ cursor: (idx + 1) % s.keys.length }));
    try {
      const sep = path.includes("?") ? "&" : "?";
      const res = await limited(`https://api.helius.xyz${path}${sep}api-key=${k.key}`);
      if (res.status === 429) { await on429(idx, k, res); continue; }
      if (res.status === 401 || res.status === 403) { patchKey(idx, { status: "depleted", reason: "invalid", fails: k.fails + 1 }); continue; }
      patchKey(idx, { calls: k.calls + 1 });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch { patchKey(idx, { fails: k.fails + 1 }); }
  }
  return null;
}

/** Ping a single key directly (bypasses rotation). */
export async function pingKey(key: string): Promise<"ok" | "rate" | "quota" | "invalid" | "error"> {
  try {
    const res = await limited(`https://mainnet.helius-rpc.com/?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) });
    if (res.status === 429) return isQuotaMsg(await res.text().catch(() => "")) ? "quota" : "rate";
    if (res.status === 401 || res.status === 403) return "invalid";
    const j = await res.json(); return j.result === "ok" ? "ok" : "error";
  } catch { return "error"; }
}
