import { CEX_HOT_WALLETS, classifyPerf, isAlphaWhale, pickTopVolume, goldenSetup, tokenEdgeScore, serverIntel, type MintTx, PUMP_PROGRAMS, TRACE_TTL, curvePctOf, proceedsSol, bundleMetrics, type TopTok } from "./edge";
import { exitDecision, dumpSignal, mirrorSignal, guessDeployer, pairRank, suspiciousDrop, type ExitGuard } from "./exit-rules";
// Server-side 24/7 cluster worker: dual-track deep trace (DEX/Raydium + Pre-Raydium Pump.fun) and auto-saves clusters per user.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Key = { key: string; status?: string };
type Tx = { feePayer: string; timestamp: number; nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[] };
type Pair = { dexId: string; baseToken: { address: string; symbol: string }; liquidity?: { usd?: number }; volume?: { m5?: number }; txns?: { m5?: { buys: number; sells: number } } };

const slots = (n: unknown, d: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(5, Math.max(0, Math.round(v))) : d; };
type CPair = Pair & { liquidity?: { usd?: number; quote?: number }; marketCap?: number; fdv?: number };
const isPumpTrack = (p: Pair) => (p.dexId === "pumpfun" || p.dexId === "pumpswap" || p.baseToken.address.endsWith("pump")) && p.dexId !== "raydium";
const curveOf = (p: CPair) => +curvePctOf(p.liquidity?.quote ?? 0, p.marketCap ?? p.fdv ?? 0).toFixed(1);
async function authorityOk(h: ReturnType<typeof helius>, mint: string) {
  const info = await h.rpc<{ value: { data: { parsed: { info: { mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const i = info?.value?.data?.parsed?.info; return !!i && !i.mintAuthority && !i.freezeAuthority;
}

/** Keys found dead (quota used up / unauthorized) stay skipped for 30 min in this worker instance. */
const deadKeys = new Map<string, number>();
const DEAD_MS = 30 * 60_000;
function helius(all: string[]) {
  let cur = 0;
  const live = () => all.filter((k) => (deadKeys.get(k) ?? 0) < Date.now());
  async function go(url: (k: string) => string, init?: RequestInit) {
    for (let i = 0; i < all.length * 2; i++) {
      const keys = live(); if (!keys.length) return null;
      const k = keys[cur++ % keys.length]!;
      const res = await fetch(url(k), init).catch(() => null);
      if (res && (res.status === 401 || res.status === 403)) { deadKeys.set(k, Date.now() + DEAD_MS); continue; }
      if (res && res.status === 429) {
        const t = await res.text().catch(() => "");
        if (/max usage|usage limit|credits? (exhausted|exceeded)/i.test(t)) { deadKeys.set(k, Date.now() + DEAD_MS); continue; }
        await new Promise((r) => setTimeout(r, 300)); continue;
      }
      if (!res) { await new Promise((r) => setTimeout(r, 300)); continue; }
      if (!res.ok) return null;
      return res.json();
    }
    return null;
  }
  return {
    rpc: async <T>(method: string, params: unknown[]) => {
      const j = await go((k) => `https://mainnet.helius-rpc.com/?api-key=${k}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return (j?.result ?? null) as T | null;
    },
    rest: async <T>(path: string) => (await go((k) => `https://api.helius.xyz${path}${path.includes("?") ? "&" : "?"}api-key=${k}`)) as T | null,
    txs: async (addr: string, limit = 100) => ((await go((k) => `https://api.helius.xyz/v0/addresses/${addr}/transactions?limit=${limit}&api-key=${k}`)) ?? []) as Tx[],
  };
}

async function feed(): Promise<Pair[]> {
  const j = (u: string) => fetch(u).then((r) => r.json()).catch(() => []);
  const lists = await Promise.all(["token-profiles/latest/v1", "token-boosts/latest/v1", "token-boosts/top/v1"].map((p) => j(`https://api.dexscreener.com/${p}`)));
  const addrs = [...new Set(lists.flat().filter((x: { chainId?: string }) => x?.chainId === "solana").map((x: { tokenAddress: string }) => x.tokenAddress))].slice(0, 60);
  const chunks = [addrs.slice(0, 30), addrs.slice(30)].filter((c) => c.length);
  const res = (await Promise.all(chunks.map((c) => j(`https://api.dexscreener.com/tokens/v1/solana/${c.join(",")}`)))).flat() as Pair[];
  const best = new Map<string, Pair>();
  for (const p of res) { const k = p?.baseToken?.address; if (k && (!best.has(k) || pairRank(p) > pairRank(best.get(k)!))) best.set(k, p); }
  return [...best.values()];
}

async function tierOf(h: ReturnType<typeof helius>, p: Pair, minLp: number): Promise<"tierA" | "tierB" | "pending" | "quarantine" | null> {
  const t = p.txns?.m5 ?? { buys: 0, sells: 0 };
  const ratio = (t.buys + 1) / (t.sells + 1);
  const vol = p.volume?.m5 ?? 0;
  if (vol <= 0) return null;
  const mint = p.baseToken.address;
  // Hard-reject (active mint/freeze authority) never burns deep-trace quota.
  const info = await h.rpc<{ value: { data: { parsed: { info: { mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const i = info?.value?.data?.parsed?.info; if (!i || i.mintAuthority || i.freezeAuthority) return null;
  if (vol > 20_000 && ratio > 1.1) return "tierB";
  if (ratio < 0.5 && t.sells > 20) return "quarantine";
  if ((p.liquidity?.usd ?? 0) < minLp) return "quarantine";
  const sup = await h.rpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
  const big = await h.rpc<{ value: { uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
  const total = sup?.value.uiAmount; if (!big || !total) return null;
  const pcts = big.value.map((a) => (a.uiAmount / total) * 100); if ((pcts[0] ?? 0) > 20) pcts.shift();
  return pcts.slice(0, 10).reduce((a, b) => a + b, 0) < 15 ? "tierA" : ratio >= 1 ? "pending" : "quarantine";
}

async function firstFunder(h: ReturnType<typeof helius>, addr: string) {
  const list = await h.txs(addr);
  for (let i = list.length - 1; i >= 0; i--) for (const n of list[i]!.nativeTransfers ?? [])
    if (n.toUserAccount === addr && n.fromUserAccount !== addr && n.amount > 1e7) return { from: n.fromUserAccount, sol: n.amount / 1e9, at: list[i]!.timestamp * 1000 };
  return null;
}

async function traceReverse(h: ReturnType<typeof helius>, mint: string, pumpCurve = false) {
  const sup = await h.rpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
  const big = await h.rpc<{ value: { address: string; uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
  const total = sup?.value.uiAmount ?? 0; if (!big || !total) return null;
  const accs = big.value.slice(0, 16);
  const own = await h.rpc<{ value: ({ data: { parsed: { info: { owner: string } } } } | null)[] }>("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
  const holders = accs.map((a, i) => ({ owner: own?.value[i]?.data.parsed.info.owner ?? a.address, pct: (a.uiAmount / total) * 100 })).filter((x, i) => !((pumpCurve || i === 0) && x.pct > 20) && !PUMP_PROGRAMS.has(x.owner));
  const funded = [];
  for (const x of holders) funded.push({ ...x, f: await firstFunder(h, x.owner) }); // sequential to protect quota
  const groups = new Map<string, typeof funded>();
  for (const x of funded) if (x.f) groups.set(x.f.from, [...(groups.get(x.f.from) ?? []), x]);
  const [master, kids] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ["", []];
  if (!master || kids.length < 2) return null;
  const { bundleScore } = bundleMetrics(kids.map((k) => k.f!.sol), kids.map((k) => k.f!.at));
  const totalSupplyPct = +kids.reduce((a, k) => a + k.pct, 0).toFixed(2);
  return { master, kids: kids.map((k) => k.owner), bundleScore, totalSupplyPct };
}

export async function runClusterWorker() {
  const db = supabaseAdmin;
  // Replay guard: cron fires every minute; never run more than once per 50s regardless of caller.
  const { data: last } = await db.from("cluster_worker").select("*").eq("id", "main").maybeSingle();
  if (last && Date.now() - Date.parse(last.ran_at) < 50_000) return { skipped: true };
  const traced = { ...((last?.traced as Record<string, number>) ?? {}) };
  await db.from("cluster_worker").upsert({ id: "main", ran_at: new Date().toISOString(), traced });

  const { data: users } = await db.from("user_state").select("user_id, data");
  const { data: runs } = await db.from("cluster_worker").select("id, ran_at").like("id", "user:%");
  const lastRun = new Map((runs ?? []).map((r) => [r.id.slice(5), Date.parse(r.ran_at)]));
  const eligible = (users ?? []).map((u) => {
    const d = u.data as { keys?: Key[]; autoSaveCluster?: boolean; guard?: { minLp?: number }; helius?: { master?: boolean; worker?: boolean; scanInterval?: number; radarAutoTrace?: boolean; traceSlotsGeneral?: number; traceSlotsPumpFun?: number } };
    const mins = Math.min(30, Math.max(1, Number(d.helius?.scanInterval) || 5));
    const due = Date.now() - (lastRun.get(u.user_id) ?? 0) >= (mins * 60 - 30) * 1000;
    return { id: u.user_id, keys: (d.keys ?? []).map((k) => k.key).filter(Boolean), on: due && d.autoSaveCluster !== false && d.helius?.master !== false && d.helius?.worker !== false, minLp: d.guard?.minLp ?? 15_000, sg: d.helius?.radarAutoTrace === false ? 0 : slots(d.helius?.traceSlotsGeneral, 2), sp: d.helius?.radarAutoTrace === false ? 0 : slots(d.helius?.traceSlotsPumpFun, 1) };
  }).filter((u) => u.on && u.keys.length && u.sg + u.sp > 0);
  const note = (id: string) => async (e: unknown) => { await db.from("cluster_worker").update({ last_result: { error: String((e as Error)?.stack ?? e).slice(0, 800), at: new Date().toISOString() } }).eq("id", id); return { error: String(e) }; };
  const daily = await runDailyTopVolume(users ?? []).catch(note("topvol"));
  const alpha = await runAlphaHunter(users ?? []).catch(note("alpha"));
  if (daily || alpha) console.log("daily/alpha", JSON.stringify({ daily, alpha }).slice(0, 500));
  const autoBuy = await runServerAutoBuy(users ?? [], lastRun).catch((e) => ({ error: String(e) }));
  const exits = await runServerExitTracker().catch((e) => ({ error: String(e) }));
  await syncHeliusWebhook().catch((e) => console.error("webhook sync", e));
  if (!eligible.length) return { users: 0, autoBuy, exits };
  await db.from("cluster_worker").upsert(eligible.map((u) => ({ id: `user:${u.id}`, ran_at: new Date().toISOString() })));

  const now = Date.now();
  for (const k of Object.keys(traced)) if (now - traced[k]! > TRACE_TTL) delete traced[k];
  const all = ((await feed()) as CPair[]).filter((p) => !traced[p.baseToken.address]);
  const byVol = (a: Pair, b: Pair) => (b.volume?.m5 ?? 0) - (a.volume?.m5 ?? 0);
  // Track 1: DEX/Raydium; Track 2: Pre-Raydium Pump.fun with real activity (curve >=15% or vol5m >= $1k).
  const dexPairs = all.filter((p) => !isPumpTrack(p)).sort(byVol).slice(0, 12);
  const pumpPairs = all.filter((p) => isPumpTrack(p)).map((p) => ({ p, curve: curveOf(p) })).filter((x) => x.curve < 100 && (x.curve >= 15 || (x.p.volume?.m5 ?? 0) >= 1000)).sort((a, b) => byVol(a.p, b.p)).slice(0, 10);
  const maxG = Math.max(...eligible.map((u) => u.sg)), maxP = Math.max(...eligible.map((u) => u.sp));

  // Shared key pool; each result is saved only to users whose slot quota covers its position in that track.
  const h = helius(eligible.flatMap((u) => u.keys));
  const results: { mint: string; symbol: string; tier: string; wallets: number; track: "dex" | "pump" }[] = [];
  const save = async (c: NonNullable<Awaited<ReturnType<typeof traceReverse>>>, rowsFor: (c: NonNullable<Awaited<ReturnType<typeof traceReverse>>>) => { address: string; tag: string; note: string }[], who: typeof eligible) => {
    const rows = rowsFor(c).filter((r) => !CEX_HOT_WALLETS[r.address]);
    for (const u of who) {
      const { data: ex } = await db.from("wallet_tags").select("address, note, seen").eq("user_id", u.id).in("address", rows.map((r) => r.address));
      const manual = new Set((ex ?? []).filter((e) => !e.note.startsWith("Auto:")).map((e) => e.address));
      const seen = new Map((ex ?? []).map((e) => [e.address, e.seen]));
      // Auto-promote: a "watch" wallet seen in >=3 separate clusters becomes a cabal candidate.
      const up = rows.filter((r) => !manual.has(r.address)).map((r) => { const n = (seen.get(r.address) ?? 0) + 1; return { ...r, tag: r.tag === "watch" && n >= 3 ? "cabal" : r.tag, user_id: u.id, seen: n }; });
      if (up.length) await db.from("wallet_tags").upsert(up, { onConflict: "user_id,address" });
    }
  };

  let gi = 0;
  for (const p of dexPairs) {
    if (gi >= maxG) break;
    const tier = await tierOf(h, p, Math.min(...eligible.map((u) => u.minLp)));
    if (!tier) continue;
    const slot = gi++;
    traced[p.baseToken.address] = Date.now();
    const c = await traceReverse(h, p.baseToken.address);
    results.push({ mint: p.baseToken.address, symbol: p.baseToken.symbol, tier, wallets: c ? c.kids.length + 1 : 0, track: "dex" });
    if (!c) continue;
    const via = p.baseToken.address.slice(0, 6);
    const lbl = { tierA: "Tier A", tierB: "Tier B", pending: "Pending", quarantine: "Quarantine" }[tier];
    await save(c, (c) => [
      { address: c.master, tag: c.bundleScore > 70 || c.totalSupplyPct > 20 ? "rugger" : "watch", note: `Auto: Master funder via ${via}… (bundle ${c.bundleScore}, cluster ${c.totalSupplyPct}%) [${lbl} Auto-Trace · 24/7 worker]` },
      ...c.kids.map((k) => ({ address: k, tag: c.bundleScore >= 60 ? "cabal" : "watch", note: `Auto: L1 sub-wallet of ${c.master.slice(0, 6)}… via ${via}… [${lbl} Auto-Trace · 24/7 worker]` })),
    ], eligible.filter((u) => u.sg > slot));
  }

  let pi = 0;
  for (const { p, curve } of pumpPairs) {
    if (pi >= maxP) break;
    if (!(await authorityOk(h, p.baseToken.address))) continue;
    const slot = pi++;
    traced[p.baseToken.address] = Date.now();
    const c = await traceReverse(h, p.baseToken.address, true);
    results.push({ mint: p.baseToken.address, symbol: p.baseToken.symbol, tier: "pumpfun", wallets: c ? c.kids.length + 1 : 0, track: "pump" });
    if (!c) continue;
    const sym = p.baseToken.symbol;
    await save(c, (c) => [
      { address: c.master, tag: c.bundleScore > 70 || c.totalSupplyPct > 20 ? "rugger" : "watch", note: `Auto: Pump.fun Bundler master via $${sym}… (curve ${curve}%, bundle ${c.bundleScore}) [Pump.fun Auto-Trace · 24/7 worker]` },
      ...c.kids.map((k) => ({ address: k, tag: c.bundleScore >= 60 ? "cabal" : "watch", note: `Auto: Pump.fun Bundler via $${sym}… (curve ${curve}%) [Pump.fun Auto-Trace · 24/7 worker]` })),
    ], eligible.filter((u) => u.sp > slot));
  }
  await db.from("cluster_worker").update({ traced, last_result: { at: new Date().toISOString(), results } }).eq("id", "main");
  return { users: eligible.length, results, autoBuy, exits };
}

/* ---------------- 24/7 Background AutoBuy (paper) ---------------- */
type AB = { enabled?: boolean; background24x7?: boolean; onBreakout?: boolean; onCabalInflow?: boolean; onCurveSweetSpot?: boolean; onSafeOrganic?: boolean; onVolumeSurge?: boolean; sizeSol?: number; maxOpen?: number; cooldownMin?: number; curveMin?: number; curveMax?: number; cabalOnly?: boolean; fMinLiq?: boolean; minLiqUsd?: number; fMcap?: boolean; mcapMin?: number; mcapMax?: number; fMinBuys?: boolean; minBuys5m?: number; fMaxAge?: boolean; maxAgeMin?: number; fMaxTop10?: boolean; maxTop10?: number; tagGate?: boolean };
type PumpPair = Pair & { pairCreatedAt?: number; priceUsd?: string; liquidity?: { usd?: number; quote?: number }; marketCap?: number; fdv?: number };
const SOL = "So11111111111111111111111111111111111111112";

/** Multi-tier SOL/USD: Jupiter → DexScreener → Binance. */
async function solPrice() {
  const j = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL}`).then((x) => x.json()).catch(() => null);
  const a = Number(j?.[SOL]?.usdPrice); if (a > 0) return a;
  const d = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL}`).then((x) => x.json()).catch(() => null);
  const pr = ((d?.pairs ?? []) as { quoteToken?: { symbol?: string }; priceUsd?: string; liquidity?: { usd?: number } }[])
    .filter((p) => /USD/.test(p.quoteToken?.symbol ?? "")).sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
  const b = Number(pr?.priceUsd); if (b > 0) return b;
  const n = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT").then((x) => x.json()).catch(() => null);
  return Number(n?.price) || 0;
}

/* ---------------- 24/7 Background Exit Engine (TP1 / trailing stop) ---------------- */
type Pos = { id: string; token: string; symbol?: string; entry: number; sizeSol: number; qty: number; ath: number; securedPrincipal?: boolean; openedAt?: number; lastPx?: number; deployer?: string; triggers?: string[]; mirrored?: boolean };
const proceeds = (p: Pos, price: number, sol: number, liq: number, f = 1) => proceedsSol(p.qty, price, sol, liq, f);

async function tokenQuotes(mints: string[], sol: number) {
  const out = new Map<string, { price: number; liq: number; rank: number }>();
  for (let i = 0; i < mints.length; i += 30) {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.slice(i, i + 30).join(",")}`).then((x) => x.json()).catch(() => null);
    for (const p of (r?.pairs ?? []) as { dexId?: string; baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number; quote?: number } }[]) {
      const m = p.baseToken.address; const price = Number(p.priceUsd);
      if (!(price > 0)) continue;
      const rank = pairRank(p, sol); const liq = p.liquidity?.usd || (p.liquidity?.quote ?? 0) * sol * 2;
      if (!out.has(m) || rank > out.get(m)!.rank) out.set(m, { price, liq, rank });
    }
  }
  return out;
}

/** Event-driven exit pass triggered by the Helius webhook for the mints that just traded. */
export async function runWebhookExits(mints: string[]) {
  const db = supabaseAdmin;
  const { data: g } = await db.from("cluster_worker").select("ran_at").eq("id", "webhook-run").maybeSingle();
  if (g && Date.now() - Date.parse(g.ran_at) < 3_000) return { skipped: true };
  await db.from("cluster_worker").upsert({ id: "webhook-run", ran_at: new Date().toISOString() });
  return runServerExitTracker(new Set(mints));
}

const WEBHOOK_URL = "https://trade3398.lovable.app/api/public/hooks/helius";
/** Keeps one Helius enhanced webhook pointed at every mint held in an open paper position. */
async function syncHeliusWebhook() {
  const secret = process.env["HELIUS_WEBHOOK_SECRET"]; if (!secret) return;
  const db = supabaseAdmin;
  const { data: users } = await db.from("user_state").select("data");
  const ds = (users ?? []).map((u) => u.data as { positions?: Pos[]; keys?: Key[]; helius?: { master?: boolean; worker?: boolean } }).filter((d) => d.helius?.master !== false && d.helius?.worker !== false);
  const mints = [...new Set(ds.flatMap((d) => (d.positions ?? []).map((p) => p.token)))].sort().slice(0, 100);
  const keys = [...new Set(ds.flatMap((d) => (d.keys ?? []).filter((k) => k.key && k.status !== "depleted").map((k) => k.key)))];
  const { data: row } = await db.from("cluster_worker").select("last_result").eq("id", "webhook").maybeSingle();
  const cur = (row?.last_result ?? {}) as { webhookId?: string; addrs?: string[]; key?: string; at?: string };
  // Re-verify every 10 min even if unchanged: the key holding the webhook may have run out of quota.
  const fresh = cur.at && Date.now() - Date.parse(cur.at) < 600_000;
  if (!keys.length || (fresh && (cur.addrs ?? []).join() === mints.join())) return;
  const api = (key: string, path: string, method: string, body?: unknown) => fetch(`https://api.helius.xyz/v0/webhooks${path}?api-key=${key}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : null });
  let webhookId: string | undefined; let used: string | undefined;
  if (!mints.length) {
    if (cur.webhookId && cur.key) await api(cur.key, `/${cur.webhookId}`, "DELETE").catch(() => null);
  } else {
    const body = { webhookURL: WEBHOOK_URL, transactionTypes: ["ANY"], accountAddresses: mints, webhookType: "enhanced", authHeader: secret };
    const order = cur.key && keys.includes(cur.key) ? [cur.key, ...keys.filter((k) => k !== cur.key)] : keys;
    for (const key of order) {
      let r = cur.webhookId && key === cur.key ? await api(key, `/${cur.webhookId}`, "PUT", body).catch(() => null) : null;
      if (!r || !r.ok) {
        const list = await api(key, "", "GET").catch(() => null);
        if (!list || !list.ok) continue; // quota exhausted / invalid key
        const ex = ((await list.json()) as { webhookID: string; webhookURL: string }[]).find((w) => w.webhookURL === WEBHOOK_URL);
        r = ex ? await api(key, `/${ex.webhookID}`, "PUT", body).catch(() => null) : await api(key, "", "POST", body).catch(() => null);
      }
      if (r?.ok) { webhookId = ((await r.json()) as { webhookID?: string }).webhookID; used = key; break; }
      console.error("helius webhook", key.slice(0, 6), r?.status);
    }
    if (!used) return;
  }
  await db.from("cluster_worker").upsert({ id: "webhook", ran_at: new Date().toISOString(), last_result: { webhookId, addrs: mints, key: used, at: new Date().toISOString() } });
}

async function runServerExitTracker(only?: Set<string>) {
  const db = supabaseAdmin;
  const { data: users } = await db.from("user_state").select("user_id, data");
  const holders = (users ?? []).filter((u) => ((u.data as { positions?: Pos[] }).positions ?? []).some((p) => !only || only.has(p.token)));
  if (!holders.length) return { accounts: 0 };
  const mints = [...new Set(holders.flatMap((u) => ((u.data as { positions: Pos[] }).positions).map((p) => p.token)))].filter((m) => !only || only.has(m));
  const sol = await solPrice();
  if (!sol) return { accounts: holders.length, error: "no SOL price" };
  const [quotes, jup] = await Promise.all([tokenQuotes(mints, sol), fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.slice(0, 50).join(",")}`).then((x) => x.json()).catch(() => ({}))]);
  const events: string[] = [];

  for (const u of holders) {
    const d = u.data as Record<string, unknown> & { balance?: number; positions: Pos[]; trades?: unknown[]; equity?: number[]; alerts?: unknown[]; guard?: ExitGuard; keys?: Key[]; memory?: { address: string; tag: string }[] };
    const ukeys = (d.keys ?? []).map((k) => k.key).filter(Boolean);
    const mir = (d.guard as { mirror?: string } | undefined)?.mirror; const mirOn = mir === "tighten" || mir === "half";
    const hd = (d.guard?.dumpSignal || mirOn) && ukeys.length ? helius(ukeys) : null;
    let tagMap: Map<string, string> | null = null;
    const tagOf = async () => {
      if (tagMap) return tagMap;
      const { data: rows } = await db.from("wallet_tags").select("address, tag").eq("user_id", u.user_id);
      tagMap = new Map((d.memory ?? []).map((m) => [m.address, m.tag]));
      for (const r of rows ?? []) tagMap.set(r.address, r.tag);
      return tagMap;
    };
    let balance = Number(d.balance ?? 10); let positions = [...d.positions];
    const trades = [...((d.trades as unknown[]) ?? [])]; const alerts = [...((d.alerts as unknown[]) ?? [])];
    let changed = false;
    for (const p0 of d.positions) {
      if (only && !only.has(p0.token)) continue;
      const q = quotes.get(p0.token); if (!q || !p0.entry) continue;
      let p = p0;
      if (suspiciousDrop(p.lastPx, q.price, Number(jup?.[p.token]?.usdPrice) || undefined)) continue;
      if (p.lastPx !== q.price) { p = { ...p, lastPx: q.price }; positions = positions.map((x) => x.id === p.id ? p : x); changed = true; }
      if (q.price > (p.ath || 0)) { p = { ...p, ath: q.price }; positions = positions.map((x) => x.id === p.id ? p : x); changed = true; }
      const tag = p.symbol ? `$${p.symbol}` : `${p.token.slice(0, 4)}…${p.token.slice(-4)}`;
      const sell = (f: number, reason: string, text: string) => {
        const outSol = proceeds(p, q.price, sol, q.liq, f); const cost = p.sizeSol * f;
        balance += outSol;
        positions = f >= 1 ? positions.filter((x) => x.id !== p.id) : positions.map((x) => x.id === p.id ? { ...x, qty: x.qty * (1 - f), sizeSol: x.sizeSol - cost, securedPrincipal: true } : x);
        trades.unshift({ id: `${p.id}-${Date.now()}`, token: p.token, symbol: p.symbol, pnlSol: outSol - cost, roi: ((outSol - cost) / cost) * 100, closedAt: Date.now(), reason });
        alerts.unshift({ id: `${Date.now()}-${p.id}-exit`, kind: "info", text, at: Date.now() });
        changed = true; events.push(`${u.user_id.slice(0, 6)}:${tag}:${reason}`);
      };
      let dec: { kind: string; label: string } | null = exitDecision(p, q.price, d.guard ?? {});
      if (!dec && hd) {
        const txs = await hd.txs(p.token, 100).catch(() => []) as (Tx & { tokenTransfers?: { fromUserAccount: string; mint: string }[] })[];
        const pm = p as typeof p & { triggers?: string[]; mirrored?: boolean };
        const mr = mirOn && !pm.mirrored ? mirrorSignal(txs as never, p.token, pm.triggers, p.openedAt) : null;
        if (mr) {
          p = { ...p, mirrored: true } as typeof p; positions = positions.map((x) => x.id === p.id ? p : x); changed = true;
          if (mir === "half") sell(0.5, `${mr.label} — jual 50% [24/7 worker]`, `🪞 24/7 ${mr.label}: ${tag} (50% dijual)`);
          else alerts.unshift({ id: `${Date.now()}-${p.id}-mirror`, kind: "dump", text: `🪞 24/7 ${mr.label}: ${tag} → trailing −10%`, at: Date.now() });
          continue;
        }
        if (!d.guard?.dumpSignal) continue;
        const dep = p.deployer ?? guessDeployer(txs);
        if (dep && !p.deployer) { p = { ...p, deployer: dep } ; positions = positions.map((x) => x.id === p.id ? p : x); changed = true; }
        const tm = await tagOf();
        dec = dumpSignal(txs, p.token, dep, (a) => tm.get(a), p.openedAt);
      }
      if (dec?.kind === "tp1") sell(0.5, `${dec.label} [24/7 worker]`, `🎯 24/7 ${dec.label}: ${tag} (50% secured)`);
      else if (dec) sell(1, `${dec.label} [24/7 worker]`, `🛑 24/7 ${dec.label}: ${tag} closed`);
    }
    if (!changed) continue;
    const equity = [...((d.equity as number[]) ?? []), balance + positions.reduce((a, x) => a + x.sizeSol, 0)].slice(-200);
    await db.from("user_state").update({ data: { ...d, balance, positions, trades, equity, alerts: alerts.slice(0, 200) } as never, updated_at: new Date().toISOString() }).eq("user_id", u.user_id);
  }
  return { accounts: holders.length, events };
}
async function jupQuote(out: string, lamports: number) {
  const r = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${out}&amount=${Math.floor(lamports)}&slippageBps=800`).then((x) => x.json()).catch(() => null);
  return r?.outAmount ? { impactPct: Number(r.priceImpactPct ?? 0) * 100 } : null;
}

async function runServerAutoBuy(users: { user_id: string; data: unknown }[], lastRun: Map<string, number>) {
  const db = supabaseAdmin;
  const buyers = users.map((u) => ({ id: u.user_id, d: u.data as Record<string, unknown> & { autoBuy?: AB; keys?: Key[]; helius?: { master?: boolean; worker?: boolean; scanInterval?: number } } }))
    .filter(({ id, d }) => {
      const mins = Math.min(30, Math.max(1, Number(d.helius?.scanInterval) || 5));
      const due = Date.now() - (lastRun.get(`ab:${id}`) ?? 0) >= (mins * 60 - 30) * 1000;
      return due && d.autoBuy?.enabled && d.autoBuy?.background24x7 && d.helius?.master !== false && d.helius?.worker !== false && (d.keys ?? []).some((k) => k.key && k.status !== "depleted" && !deadKeys.has(k.key));
    });
  if (!buyers.length) return { buyers: 0 };
  await db.from("cluster_worker").upsert(buyers.map((b) => ({ id: `user:ab:${b.id}`, ran_at: new Date().toISOString() })));

  const sol = await solPrice(); if (!sol) return { buyers: buyers.length, error: "no SOL price" };
  const pumps = ((await feed()) as PumpPair[])
    .filter((p) => (p.dexId === "pumpfun" || p.baseToken.address.endsWith("pump")) && p.dexId !== "raydium" && p.dexId !== "pumpswap")
    .map((p) => { return { p, curve: curveOf(p) }; })
    .filter((x) => x.curve < 100)
    .sort((a, b) => (b.p.volume?.m5 ?? 0) - (a.p.volume?.m5 ?? 0)).slice(0, 8);
  const bought: string[] = [];

  for (const b of buyers) {
    const c: Required<AB> = { enabled: true, background24x7: true, onBreakout: true, onCabalInflow: true, onCurveSweetSpot: true, onSafeOrganic: false, onVolumeSurge: false, sizeSol: 0.2, maxOpen: 3, cooldownMin: 15, curveMin: 25, curveMax: 80, cabalOnly: true, fMinLiq: false, minLiqUsd: 8000, fMcap: false, mcapMin: 8000, mcapMax: 60000, fMinBuys: false, minBuys5m: 15, fMaxAge: false, maxAgeMin: 60, fMaxTop10: false, maxTop10: 25, tagGate: true, ...b.d.autoBuy };
    const h = helius((b.d.keys ?? []).map((k) => k.key).filter(Boolean));
    const { data: tagRows } = await db.from("wallet_tags").select("address, tag").eq("user_id", b.id);
    const tags = new Map((tagRows ?? []).map((t) => [t.address, t.tag as string]));
    let state = b.d as Record<string, unknown> & { balance?: number; positions?: { token: string }[]; trades?: unknown[]; alerts?: unknown[]; autoBuyLog?: Record<string, number> };
    let changed = false;

    for (const { p, curve } of pumps) {
      const positions = (state.positions ?? []) as { token: string }[];
      const balance = Number(state.balance ?? 10);
      if (positions.length >= c.maxOpen || balance < c.sizeSol) break;
      const mint = p.baseToken.address;
      if (positions.some((x) => x.token === mint)) continue;
      if (Date.now() - (state.autoBuyLog?.[mint] ?? 0) < c.cooldownMin * 60_000) continue;
      const tx = p.txns?.m5 ?? { buys: 0, sells: 0 };
      const ratio = (tx.buys + 1) / (tx.sells + 1); const vol = p.volume?.m5 ?? 0;
      const curveOk = curve >= c.curveMin && curve <= c.curveMax;
      if (c.onCurveSweetSpot && !curveOk) continue;
      const effLiq = p.liquidity?.usd || (p.liquidity?.quote ?? 0) * sol * 2; const mcap = p.marketCap ?? p.fdv ?? 0;
      if (c.fMinLiq && effLiq < c.minLiqUsd) continue;
      if (c.fMcap && (mcap < c.mcapMin || mcap > c.mcapMax)) continue;
      if (c.fMinBuys && tx.buys < c.minBuys5m) continue;
      if (c.fMaxAge && p.pairCreatedAt && Date.now() - p.pairCreatedAt > c.maxAgeMin * 60_000) continue;
      // Authority + holders (Helius)
      const info = await h.rpc<{ value: { data: { parsed: { info: { mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
      const ai = info?.value?.data?.parsed?.info; if (!ai || ai.mintAuthority || ai.freezeAuthority) continue;
      const sup = await h.rpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
      const big = await h.rpc<{ value: { address: string; uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
      const total = sup?.value.uiAmount ?? 0; if (!big || !total) continue;
      const accs = big.value.slice(0, 20);
      const own = await h.rpc<{ value: ({ data: { parsed: { info: { owner: string } } } } | null)[] }>("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
      const holders = accs.map((a, i) => ({ owner: own?.value[i]?.data.parsed.info.owner ?? a.address, pct: (a.uiAmount / total) * 100 }));
      const elite = holders.filter((x) => { const t = tags.get(x.owner); return t === "cabal" || t === "watch"; }).length;
      const rugger = holders.some((x) => tags.get(x.owner) === "rugger");
      const pcts = holders.map((x) => x.pct); if ((pcts[0] ?? 0) > 20) pcts.shift(); // bonding curve account
      const top10 = pcts.slice(0, 10).reduce((a, v) => a + v, 0);
      if (rugger) continue;
      if (c.cabalOnly && elite === 0) continue;
      if (c.onSafeOrganic && !(top10 < 15)) continue;
      if (c.fMaxTop10 && top10 > c.maxTop10) continue;
      const hit = (c.onBreakout && vol > 20_000 && ratio > 1.3) || (c.onCabalInflow && elite >= 2) || (c.onVolumeSurge && ratio >= 1.5);
      if (!hit) continue;
      // Golden Setup (always enforced on the server): full intel from the last 100 mint transactions.
      const cabalH = holders.filter((x) => tags.get(x.owner) === "cabal");
      if (cabalH.length < 1 || elite < 2) continue;
      const mtx = (await h.txs(mint, 100)) as unknown as MintTx[];
      const intel = serverIntel(mint, mtx, tags, cabalH.length, elite - cabalH.length, top10);
      const golden = goldenSetup(intel, tokenEdgeScore(intel, top10));
      if (!golden.ok) continue;
      const price = Number(p.priceUsd ?? 0); if (!price) continue;
      const q = await jupQuote(mint, c.sizeSol * 1e9); if (!q || q.impactPct > 8) continue;
      const fill = price * (1 + q.impactPct / 100);
      const pos = { id: `${Date.now()}`, token: mint, symbol: p.baseToken.symbol, entry: fill, sizeSol: c.sizeSol, qty: (c.sizeSol * sol) / fill, ath: fill, securedPrincipal: false, openedAt: Date.now() };
      const alert = { id: `${Date.now()}-ab`, kind: "buy", text: `🌙 24/7 AutoBuy ${c.sizeSol} SOL $${p.baseToken.symbol} (curve ${curve}%, elite ${elite})`, at: Date.now() };
      state = { ...state, balance: balance - c.sizeSol, positions: [pos, ...positions], alerts: [alert, ...((state.alerts as unknown[]) ?? [])].slice(0, 200), autoBuyLog: { ...(state.autoBuyLog ?? {}), [mint]: Date.now() } };
      changed = true; bought.push(`${b.id.slice(0, 6)}:${p.baseToken.symbol}`);
    }
    if (changed) await db.from("user_state").update({ data: state as never, updated_at: new Date().toISOString() }).eq("user_id", b.id);
  }
  return { buyers: buyers.length, bought };
}

/* ---------------- Daily top-volume scan → Radar + Alpha Whale hunter → Memory ---------------- */
type UserRow = { user_id: string; data: unknown };
type ScanCfg = { keys?: Key[]; guard?: { minLp?: number }; helius?: { master?: boolean; worker?: boolean; dailyTopVolume?: boolean; alphaHunter?: boolean } };
const DAY = 86_400_000, ALPHA_EVERY = 6 * 3_600_000;
const cfgUsers = (users: UserRow[], flag: "dailyTopVolume" | "alphaHunter") => users.map((u) => ({ id: u.user_id, d: u.data as ScanCfg }))
  .filter((u) => u.d.helius?.master !== false && u.d.helius?.worker !== false && u.d.helius?.[flag] !== false)
  .map((u) => ({ id: u.id, keys: (u.d.keys ?? []).map((k) => k.key).filter(Boolean), minLp: u.d.guard?.minLp ?? 15_000 }))
  .filter((u) => u.keys.length);
async function gate(id: string, every: number) {
  const { data } = await supabaseAdmin.from("cluster_worker").select("ran_at, last_result").eq("id", id).maybeSingle();
  if (data && Date.now() - Date.parse(data.ran_at) < every) return null;
  await supabaseAdmin.from("cluster_worker").upsert({ id, ran_at: new Date().toISOString() });
  return true;
}

export async function runDailyTopVolume(users: UserRow[]) {
  const who = cfgUsers(users, "dailyTopVolume");
  if (!who.length || !(await gate("topvol", DAY))) return null;
  const j = (u: string) => fetch(u).then((r) => r.json()).catch(() => null);
  const searches = await Promise.all(["solana", "SOL", "pump", "raydium"].map((q) => j(`https://api.dexscreener.com/latest/dex/search?q=${q}`)));
  const pool = [...(await feed()), ...searches.flatMap((x) => (x?.pairs ?? []) as Pair[])] as (CPair & { chainId?: string; volume?: { h24?: number; m5?: number } })[];
  const top = pickTopVolume(pool, Math.min(...who.map((u) => u.minLp)), 30);
  const h = helius(who.flatMap((u) => u.keys));
  const live = !!(await h.rpc<number>("getSlot", []));
  const toks: TopTok[] = [];
  for (const p of top) {
    if (!live) { toks.push({ mint: p.baseToken.address, symbol: p.baseToken.symbol, vol24: Math.round(p.volume?.h24 ?? 0), liq: Math.round(p.liquidity?.usd ?? 0), tier: "unverified", track: isPumpTrack(p) ? "pump" : "dex" }); continue; }
    const track = isPumpTrack(p) ? "pump" : "dex";
    const probe = await h.rpc<{ value: unknown }>("getAccountInfo", [p.baseToken.address, { encoding: "jsonParsed" }]);
    const tier = !probe ? "unverified" : track === "pump" ? ((await authorityOk(h, p.baseToken.address)) ? "pumpfun" : "rejected") : ((await tierOf(h, p, 0)) ?? "rejected");
    toks.push({ mint: p.baseToken.address, symbol: p.baseToken.symbol, vol24: Math.round(p.volume?.h24 ?? 0), liq: Math.round(p.liquidity?.usd ?? 0), tier, track });
  }
  const at = new Date().toISOString();
  const { error: werr } = await supabaseAdmin.from("cluster_worker").upsert({ id: "topvol", ran_at: at, last_result: { at, tokens: toks, pool: pool.length } as never });
  if (werr) throw new Error(`topvol write: ${werr.message}`);
  for (const u of who) {
    await supabaseAdmin.from("scan_history").delete().eq("user_id", u.id).eq("kind", "topvol");
    await supabaseAdmin.from("scan_history").insert(toks.map((t) => ({ user_id: u.id, kind: "topvol", address: `topvol:${t.mint}`, scanned_at: at, summary: JSON.stringify(t) })));
  }
  return { tokens: toks.length, users: who.length };
}

/** Alpha hunter: wallet track records cached 2h so shared holders across tokens are not re-fetched. */
const TR_TTL = 2 * 60 * 60_000;
const trCache = new Map<string, { at: number; v: Awaited<ReturnType<typeof serverTrackRecordRaw>> }>();
async function serverTrackRecord(h: ReturnType<typeof helius>, addr: string) {
  const c = trCache.get(addr); if (c && Date.now() - c.at < TR_TTL) return c.v;
  const v = await serverTrackRecordRaw(h, addr);
  if (v) { trCache.set(addr, { at: Date.now(), v }); if (trCache.size > 3000) trCache.delete(trCache.keys().next().value!); }
  return v;
}
async function serverTrackRecordRaw(h: ReturnType<typeof helius>, addr: string) {
  type S = { timestamp: number; tokenTransfers?: { fromUserAccount: string; toUserAccount: string; mint: string }[]; accountData?: { account: string; nativeBalanceChange: number; tokenBalanceChanges?: { userAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[] }[] };
  const list = await h.rest<S[]>(`/v0/addresses/${addr}/transactions?limit=100&type=SWAP`);
  if (!list) return null;
  const per = new Map<string, { spent: number; got: number; first: number; lastSell: number }>();
  for (const t of [...list].sort((a, b) => a.timestamp - b.timestamp)) {
    let sol = (t.accountData?.find((a) => a.account === addr)?.nativeBalanceChange ?? 0) / 1e9;
    for (const a of t.accountData ?? []) for (const c of a.tokenBalanceChanges ?? []) if (c.userAccount === addr && c.mint === SOL) sol += Number(c.rawTokenAmount.tokenAmount) / 10 ** c.rawTokenAmount.decimals;
    const mints = new Set((t.tokenTransfers ?? []).filter((x) => x.mint !== SOL && (x.toUserAccount === addr || x.fromUserAccount === addr)).map((x) => x.mint));
    if (mints.size !== 1 || !sol) continue;
    const m = [...mints][0]!; const e = per.get(m) ?? { spent: 0, got: 0, first: t.timestamp, lastSell: 0 };
    if (sol < 0) e.spent += -sol; else { e.got += sol; e.lastSell = t.timestamp; }
    per.set(m, e);
  }
  const closed = [...per.values()].filter((e) => e.spent > 0.01 && e.got > 0).sort((a, b) => b.first - a.first).slice(0, 10);
  return { ...classifyPerf(closed.map((e) => ({ roi: e.got / e.spent, holdSec: e.lastSell - e.first }))), at: Date.now() };
}

export async function runAlphaHunter(users: UserRow[]) {
  const who = cfgUsers(users, "alphaHunter");
  if (!who.length || !(await gate("alpha", ALPHA_EVERY))) return null;
  const { data: tv } = await supabaseAdmin.from("cluster_worker").select("last_result").eq("id", "topvol").maybeSingle();
  let toks = (((tv?.last_result as { tokens?: TopTok[] } | null)?.tokens) ?? []).filter((t) => t.tier !== "rejected").map((t) => t.mint);
  const heliusOk = !!(await helius(who.flatMap((u) => u.keys)).rpc<number>("getSlot", []));
  if (!heliusOk) { await supabaseAdmin.from("cluster_worker").delete().eq("id", "alpha"); return { error: "helius keys exhausted" }; }
  if (!toks.length) toks = (await feed()).map((p) => p.baseToken.address);
  const h = helius(who.flatMap((u) => u.keys));
  const cands = new Map<string, string>(); // wallet -> via mint
  for (const mint of toks.slice(0, 10)) {
    const sup = await h.rpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
    const big = await h.rpc<{ value: { address: string; uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
    const total = sup?.value.uiAmount ?? 0; if (!big || !total) continue;
    const accs = big.value.slice(0, 14);
    const own = await h.rpc<{ value: ({ data: { parsed: { info: { owner: string } } } } | null)[] }>("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
    let n = 0;
    for (let i = 0; i < accs.length && n < 10; i++) {
      const owner = own?.value[i]?.data?.parsed?.info?.owner; const pct = (accs[i]!.uiAmount / total) * 100;
      if (!owner || pct > 20 || PUMP_PROGRAMS.has(owner) || CEX_HOT_WALLETS[owner]) continue;
      if (!cands.has(owner)) cands.set(owner, mint); n++;
    }
  }
  // Skip wallets already rated in the last 24h for every user.
  const { data: rated } = await supabaseAdmin.from("wallet_tags").select("address, perf").in("address", [...cands.keys()]);
  for (const r of rated ?? []) { const at = (r.perf as { at?: number } | null)?.at ?? 0; if (Date.now() - at < DAY) cands.delete(r.address); }
  const found: { address: string; perf: NonNullable<Awaited<ReturnType<typeof serverTrackRecord>>>; via: string }[] = [];
  let rated2 = 0;
  for (const [address, via] of cands) {
    if (rated2++ >= 60) break;
    const perf = await serverTrackRecord(h, address);
    if (!perf) break; // keys exhausted
    if (isAlphaWhale(perf)) found.push({ address, perf: { ...perf, cls: "alpha" }, via });
  }
  for (const u of who) {
    if (!found.length) break;
    const { data: ex } = await supabaseAdmin.from("wallet_tags").select("address, tag, note, seen").eq("user_id", u.id).in("address", found.map((f) => f.address));
    const exMap = new Map((ex ?? []).map((e) => [e.address, e]));
    const rows = found.map((f) => {
      const e = exMap.get(f.address);
      const note = `Auto: Alpha Whale via Radar ${f.via.slice(0, 6)}… — WR ${f.perf.winRate}%, ROI ${f.perf.avgRoi}× (${f.perf.tokens} token)`;
      return e ? { user_id: u.id, address: f.address, tag: e.tag, note: e.note, seen: e.seen + 1, perf: f.perf as never } : { user_id: u.id, address: f.address, tag: "cabal", note, seen: 1, perf: f.perf as never };
    });
    await supabaseAdmin.from("wallet_tags").upsert(rows, { onConflict: "user_id,address" });
  }
  const res = { at: new Date().toISOString(), candidates: cands.size, rated: rated2, alpha: found.length, wallets: found.map((f) => f.address) };
  await supabaseAdmin.from("cluster_worker").update({ last_result: res as never }).eq("id", "alpha");
  return res;
}
