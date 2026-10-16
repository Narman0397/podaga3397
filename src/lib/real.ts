// Real on-chain / market data layer. No simulated values: anything unknown is returned as null.
import { fetchMint, heliusRest, heliusRpc } from "./helius";
import { blacklistLabel, getState } from "./store";
import type { Cluster, Edge, Node, TokenMarket } from "./sim";
import { pairRank } from "./exit-rules";
import { CEX_HOT_WALLETS, SYSTEM_PROGRAM, findSweepers, FRESH_SEC, BUNDLE_SEC, classifyPerf, type WalletPerf, PUMP_PROGRAMS, bundleMetrics, curvePctOf } from "./edge";
const exLabel = (a: string) => CEX_HOT_WALLETS[a] ?? blacklistLabel(a);

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const hasKeys = () => getState().keys.some((k) => k.status === "active");

interface DsPair {
  dexId: string; pairAddress?: string; baseToken: { address: string; symbol: string }; priceUsd?: string; priceNative?: string;
  liquidity?: { usd?: number; quote?: number; base?: number }; marketCap?: number; fdv?: number;
}

let solCache = { v: 0, at: 0 };
export async function solUsd(): Promise<number> {
  if (Date.now() - solCache.at < 30_000 && solCache.v) return solCache.v;
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`).then((x) => x.json());
    const v = Number(r?.[SOL_MINT]?.usdPrice);
    if (v > 0) { solCache = { v, at: Date.now() }; return v; }
  } catch { /* fallthrough */ }
  return solCache.v || 0;
}

/** Best pair (highest liquidity) per mint from DexScreener. */
export async function bestPairs(mints: string[]): Promise<Map<string, DsPair>> {
  const out = new Map<string, DsPair>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const res = (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`).then((r) => r.json()).catch(() => [])) as DsPair[];
    for (const p of res ?? []) {
      const k = p.baseToken?.address; if (!k || !chunk.includes(k)) continue;
      if (!out.has(k) || pairRank(p, solCache.v || 150) > pairRank(out.get(k)!, solCache.v || 150)) out.set(k, p);
    }
  }
  return out;
}

/** Live USD prices from Jupiter (updates every few seconds, unlike DexScreener's cached API). */
export async function jupPrices(mints: string[]): Promise<Record<string, number>> {
  const o: Record<string, number> = {};
  for (let i = 0; i < mints.length; i += 50) {
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.slice(i, i + 50).join(",")}&t=${Date.now()}`, { cache: "no-store" }).then((x) => x.json());
      for (const k of Object.keys(r ?? {})) { const v = Number(r[k]?.usdPrice); if (v > 0) o[k] = v; }
    } catch { /* ignore */ }
  }
  return o;
}

/** Real USD prices for a set of mints (DexScreener). */
export async function pricesUsd(mints: string[]): Promise<Record<string, number>> {
  const m = await bestPairs(mints); const o: Record<string, number> = {};
  m.forEach((p, k) => { const v = Number(p.priceUsd); if (v > 0) o[k] = v; });
  return o;
}

export interface RealMarket extends Omit<TokenMarket, "mintAuthority" | "freezeAuthority" | "honeypot" | "sellTax"> {
  mintAuthority: string | null | undefined; freezeAuthority: string | null | undefined; // undefined = not verified
  honeypot: boolean | null; sellTax: number | null; dexId: string; solPooled: number | null;
}

export async function fetchMarket(mint: string): Promise<RealMarket | null> {
  const p = (await bestPairs([mint])).get(mint);
  if (!p) return null;
  const sol = await solUsd();
  const onCurve = p.dexId === "pumpfun";
  const price = Number(p.priceUsd ?? 0);
  const liq = p.liquidity?.usd ?? 0;
  const mcap = p.marketCap ?? p.fdv ?? 0;
  const solPooled = p.liquidity?.quote ?? (sol ? liq / 2 / sol : null);
  // Pump.fun curve completes at ~85 real SOL in the curve.
  const curvePct = onCurve ? curvePctOf(solPooled, mcap) : 100;
  const info = hasKeys() ? await fetchMint(mint) : null;
  const tax = info ? await transferFeePct(mint) : null;
  return {
    mint, symbol: p.baseToken.symbol, price, curvePct: +curvePct.toFixed(1), migrated: !onCurve, liquidityUsd: liq,
    virtualSol: solPooled ?? 0, virtualTokens: p.liquidity?.base ?? 0, mcap, dexId: p.dexId, solPooled,
    mintAuthority: info ? info.mintAuthority : undefined, freezeAuthority: info ? info.freezeAuthority : undefined,
    sellTax: tax, honeypot: null,
  };
}

/** Token-2022 transfer-fee extension (real sell tax). 0 for classic SPL. */
async function transferFeePct(mint: string): Promise<number | null> {
  type R = { value: { owner: string; data: { parsed: { info: { extensions?: { extension: string; state: { newerTransferFee?: { transferFeeBasisPoints: number } } }[] } } } } | null };
  const r = await heliusRpc<R>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  if (!r?.value) return null;
  const ext = r.value.data.parsed.info.extensions?.find((e) => e.extension === "transferFeeConfig");
  return ext ? (ext.state.newerTransferFee?.transferFeeBasisPoints ?? 0) / 100 : 0;
}

/** Jupiter quote. Returns real price impact % and output amount, or null if no route. */
export async function quote(inputMint: string, outputMint: string, amountRaw: number, slipBps = 300) {
  try {
    const r = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amountRaw)}&slippageBps=${slipBps}`).then((x) => x.json());
    if (!r?.outAmount) return null;
    return { outAmount: Number(r.outAmount), impactPct: Number(r.priceImpactPct ?? 0) * 100 };
  } catch { return null; }
}

/** Pre-flight sell check: buy quote then sell quote back; round-trip loss beyond fees/impact flags honeypot/tax. */
export async function preflight(mint: string, sizeSol: number) {
  const buy = await quote(SOL_MINT, mint, sizeSol * 1e9);
  if (!buy) return { buyImpact: null, sellOk: false, roundTripLossPct: null };
  const sell = await quote(mint, SOL_MINT, buy.outAmount);
  if (!sell) return { buyImpact: buy.impactPct, sellOk: false, roundTripLossPct: null };
  return { buyImpact: buy.impactPct, sellOk: true, roundTripLossPct: +((1 - sell.outAmount / (sizeSol * 1e9)) * 100).toFixed(2) };
}

/* ---------------- Real cluster tracing (Helius Enhanced Transactions) ---------------- */
interface HTx { signature: string; timestamp: number; feePayer: string; nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[] }

const txs = (addr: string, limit = 100) => heliusRest<HTx[]>(`/v0/addresses/${addr}/transactions?limit=${limit}`).then((r) => r ?? []);

async function outflows(addr: string, minSol: number, max: number) {
  const list = await txs(addr);
  const agg = new Map<string, { sol: number; at: number }>();
  for (const t of list) for (const n of t.nativeTransfers ?? []) {
    if (n.fromUserAccount !== addr || n.toUserAccount === addr) continue;
    const sol = n.amount / 1e9; if (sol < minSol || exLabel(n.toUserAccount)) continue;
    const e = agg.get(n.toUserAccount) ?? { sol: 0, at: t.timestamp * 1000 };
    agg.set(n.toUserAccount, { sol: e.sol + sol, at: Math.min(e.at, t.timestamp * 1000) });
  }
  return [...agg.entries()].sort((a, b) => b[1].sol - a[1].sol).slice(0, max);
}

async function firstFunder(addr: string) {
  const list = await txs(addr);
  for (let i = list.length - 1; i >= 0; i--) for (const n of list[i]!.nativeTransfers ?? [])
    if (n.toUserAccount === addr && n.fromUserAccount !== addr && n.amount > 1e7) return { from: n.fromUserAccount, sol: n.amount / 1e9, at: list[i]!.timestamp * 1000 };
  return null;
}

async function solBal(addr: string) { const r = await heliusRpc<{ value: number }>("getBalance", [addr]); return r ? +(r.value / 1e9).toFixed(3) : 0; }

function score(nodes: Node[], edges: Edge[], root: string, master: string): Cluster {
  const l1 = edges.filter((e) => e.from === master);
  const { uniformity, windowSec: w, bundleScore } = bundleMetrics(l1.map((e) => e.sol), l1.map((e) => e.at));
  const windowSec = Math.round(w);
  return { root, funder: master, nodes, edges, totalSupplyPct: +nodes.reduce((a, n) => a + n.supplyPct, 0).toFixed(2), bundleScore, uniformity: Math.round(uniformity), windowSec };
}

/** Forward: master → L1 (SOL outflows) → L2. */
export async function traceForward(master: string): Promise<Cluster> {
  if (!hasKeys()) throw new Error("Tambahkan minimal 1 Helius API key aktif untuk tracing real.");
  const nodes: Node[] = [{ id: master, level: 0, sol: await solBal(master), supplyPct: 0, bought: false, label: "Master" }];
  const edges: Edge[] = [];
  const l1 = await outflows(master, 0.05, 8);
  for (const [id, v] of l1) {
    nodes.push({ id, level: 1, sol: await solBal(id), supplyPct: 0, bought: false });
    edges.push({ from: master, to: id, sol: +v.sol.toFixed(3), at: v.at });
    for (const [cid, cv] of await outflows(id, 0.02, 3)) {
      if (nodes.some((n) => n.id === cid)) continue;
      nodes.push({ id: cid, level: 2, sol: await solBal(cid), supplyPct: 0, bought: false });
      edges.push({ from: id, to: cid, sol: +cv.sol.toFixed(3), at: cv.at });
    }
  }
  const c = score(nodes, edges, master, master);
  const origin = await firstFunder(master);
  if (origin) { c.origin = origin.from; c.originLabel = blacklistLabel(origin.from) ?? "Unlabeled wallet"; }
  return c;
}

/** Reverse: top holders of mint → their first funder → group by shared funder = cluster. */
/** Pump.fun program / AMM accounts that must never be treated as a cabal funder or holder. */
export { PUMP_PROGRAMS };
export async function traceReverse(mint: string, opts: { pumpCurve?: boolean } = {}): Promise<Cluster> {
  if (!hasKeys()) throw new Error("Tambahkan minimal 1 Helius API key aktif untuk tracing real.");
  const sup = await heliusRpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
  const big = await heliusRpc<{ value: { address: string; uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
  const total = sup?.value.uiAmount ?? 0;
  if (!big || !total) throw new Error("Data holder token tidak tersedia.");
  const accs = big.value.slice(0, 16);
  type MA = { value: ({ data: { parsed: { info: { owner: string } } } } | null)[] };
  const own = await heliusRpc<MA>("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
  const holders = accs.map((a, i) => ({ owner: own?.value[i]?.data.parsed.info.owner ?? a.address, pct: (a.uiAmount / total) * 100 }));
  // Phase 1/2: pools are detected by account owner program (wallets are owned by the System Program), not by % supply.
  type OA = { value: ({ owner: string } | null)[] };
  const progOwner = await heliusRpc<OA>("getMultipleAccounts", [holders.map((h) => h.owner), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  const skipped: { owner: string; pct: number; reason: string }[] = [];
  const wallets = holders.filter((h, i) => {
    const po = progOwner?.value[i]?.owner;
    const reason = PUMP_PROGRAMS.has(h.owner) ? "Program Pump" : exLabel(h.owner) ? `Exchange: ${exLabel(h.owner)}` : po && po !== SYSTEM_PROGRAM ? "Pool / akun program" : !po && (opts.pumpCurve || i === 0) && h.pct > 20 ? "Pool (perkiraan >20%)" : "";
    if (reason) skipped.push({ owner: h.owner, pct: +h.pct.toFixed(2), reason });
    return !reason;
  });
  const funded = await Promise.all(wallets.map(async (h) => ({ ...h, f: await firstFunder(h.owner) })));
  const groups = new Map<string, typeof funded>();
  for (const h of funded) if (h.f && !exLabel(h.f.from)) groups.set(h.f.from, [...(groups.get(h.f.from) ?? []), h]);
  const [master, kids] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[1].reduce((s, x) => s + x.pct, 0) - a[1].reduce((s, x) => s + x.pct, 0))[0] ?? ["", []];
  const mlist = await txs(mint, 100);
  const deployer = mlist.length && mlist.length < 100 ? mlist[mlist.length - 1]!.feePayer : undefined;
  if (!master || kids.length < 2) {
    return { root: mint, deployer, nodes: [], edges: [], totalSupplyPct: 0, bundleScore: 0, uniformity: 0, windowSec: 0, skipped };
  }
  const nodes: Node[] = [{ id: master, level: 0, sol: await solBal(master), supplyPct: 0, bought: false, label: "Master" }];
  const edges: Edge[] = [];
  for (const k of kids) {
    nodes.push({ id: k.owner, level: 1, sol: await solBal(k.owner), supplyPct: +k.pct.toFixed(2), bought: true });
    edges.push({ from: master, to: k.owner, sol: +k.f!.sol.toFixed(3), at: k.f!.at });
  }
  const c = score(nodes, edges, mint, master);
  c.deployer = deployer; c.skipped = skipped;
  const origin = await firstFunder(master);
  if (origin) { c.origin = origin.from; c.originLabel = blacklistLabel(origin.from) ?? "Unlabeled wallet"; }
  return c;
}

/** Real top-10 holder concentration (excl. pool) – used by Radar when keys exist. */
export async function holderConcentration(mint: string): Promise<number | null> {
  const sup = await heliusRpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
  const big = await heliusRpc<{ value: { uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
  const total = sup?.value.uiAmount; if (!big || !total) return null;
  const pcts = big.value.map((a) => (a.uiAmount / total) * 100);
  if ((pcts[0] ?? 0) > 20) pcts.shift();
  return +pcts.slice(0, 10).reduce((a, b) => a + b, 0).toFixed(2);
}

/** Top-20 holder owners (excl. pool) with % supply — used for cluster DB cross-reference. */
export async function holderOwners(mint: string): Promise<{ owner: string; pct: number }[] | null> {
  const sup = await heliusRpc<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
  const big = await heliusRpc<{ value: { address: string; uiAmount: number }[] }>("getTokenLargestAccounts", [mint]);
  const total = sup?.value.uiAmount; if (!big || !total) return null;
  const accs = big.value.slice(0, 20);
  type MA = { value: ({ data: { parsed: { info: { owner: string } } } } | null)[] };
  const own = await heliusRpc<MA>("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
  const list = accs.map((a, i) => ({ owner: own?.value[i]?.data?.parsed?.info?.owner ?? a.address, pct: (a.uiAmount / total) * 100 }));
  if ((list[0]?.pct ?? 0) > 20) list.shift();
  return list;
}

/* ---------------- Flow intelligence: early buyers, 10-min coordinated inflow, cluster exits ---------------- */
interface HTokTx { signature: string; timestamp: number; slot?: number; feePayer: string; tokenTransfers?: { fromUserAccount: string; toUserAccount: string; mint: string; tokenAmount: number }[] }
export interface FlowIntel { earlyBuyers: string[]; earlyTagged: number; earlyRugger: boolean; coordinated: { wallets: string[]; windowMin: number } | null; exits: { wallet: string; tag: string }[]; deployerDumped: boolean; fresh: { wallet: string; at: number }[]; bundle: { wallets: string[]; windowSec: number; sameSlot: boolean } | null; txScanned: number; fromTs: number; toTs: number; genesis: boolean; deployer?: string | undefined }

/** Phase 2 Genesis scanner: pages back up to `pages`×100 tx; genesis=true when the launch was reached. Early buyers = first 50 receivers. */
export async function flowIntel(mint: string, deployer?: string, pages = 3): Promise<FlowIntel | null> {
  if (!hasKeys()) return null;
  const all: HTokTx[] = [];
  let before = ""; let genesis = false;
  for (let p = 0; p < pages; p++) {
    const page = await heliusRest<HTokTx[]>(`/v0/addresses/${mint}/transactions?limit=100${before ? `&before=${before}` : ""}`);
    if (!page?.length) break;
    all.push(...page); before = page[page.length - 1]!.signature;
    if (page.length < 100) { genesis = true; break; }
  }
  if (!all.length) return null;
  const mem = getState().memory;
  const tag = (a: string) => mem.find((m) => m.address === a)?.tag;
  const asc = [...all].sort((a, b) => a.timestamp - b.timestamp);
  const dep = deployer ?? (genesis ? asc[0]?.feePayer : undefined);
  const early: string[] = [];
  for (const t of asc) for (const x of t.tokenTransfers ?? []) {
    if (x.mint !== mint || !x.toUserAccount || early.includes(x.toUserAccount) || exLabel(x.toUserAccount) || PUMP_PROGRAMS.has(x.toUserAccount)) continue;
    if (early.length < 50) early.push(x.toUserAccount);
  }
  // Coordinated inflow: ≥2 distinct cabal/watch wallets receiving the token within any 10-minute window.
  const ins = asc.flatMap((t) => (t.tokenTransfers ?? []).filter((x) => x.mint === mint && (tag(x.toUserAccount) === "cabal" || tag(x.toUserAccount) === "watch")).map((x) => ({ w: x.toUserAccount, at: t.timestamp })));
  let coordinated: FlowIntel["coordinated"] = null;
  for (let i = 0; i < ins.length; i++) {
    const win = new Set(ins.filter((y) => y.at >= ins[i]!.at && y.at - ins[i]!.at <= 600).map((y) => y.w));
    if (win.size >= 2 && (!coordinated || win.size > coordinated.wallets.length)) {
      const ts = ins.filter((y) => win.has(y.w)).map((y) => y.at);
      coordinated = { wallets: [...win], windowMin: +((Math.max(...ts) - Math.min(...ts)) / 60).toFixed(1) };
    }
  }
  // Pisces 3: fresh tagged buys ≤15 min. Pisces 4: ≥2 tagged wallets in the same slot or ≤30s = bundle launch.
  const nowS = Date.now() / 1000;
  const insS = asc.flatMap((t) => (t.tokenTransfers ?? []).filter((x) => x.mint === mint && tag(x.toUserAccount) && tag(x.toUserAccount) !== "rugger").map((x) => ({ w: x.toUserAccount, at: t.timestamp, slot: t.slot ?? 0 })));
  const freshM = new Map<string, number>();
  for (const y of insS) if (nowS - y.at <= FRESH_SEC) freshM.set(y.w, Math.max(freshM.get(y.w) ?? 0, y.at * 1000));
  let bundle: FlowIntel["bundle"] = null;
  for (let i = 0; i < insS.length; i++) {
    const a = insS[i]!;
    const grp = insS.filter((y) => y.at >= a.at && (y.at - a.at <= BUNDLE_SEC || (a.slot && y.slot === a.slot)));
    const ws = new Set(grp.map((y) => y.w));
    if (ws.size >= 2 && (!bundle || ws.size > bundle.wallets.length)) bundle = { wallets: [...ws], windowSec: Math.max(...grp.map((y) => y.at)) - a.at, sameSlot: !!a.slot && grp.every((y) => y.slot === a.slot) };
  }
  // Exits in the last 15 minutes by tagged wallets or the deployer.
  const recent = all.filter((t) => Date.now() / 1000 - t.timestamp < 900);
  const exits = new Map<string, string>(); let deployerDumped = false;
  for (const t of recent) for (const x of t.tokenTransfers ?? []) {
    if (x.mint !== mint || !x.fromUserAccount) continue;
    const tg = tag(x.fromUserAccount);
    if (tg) exits.set(x.fromUserAccount, tg);
    if (dep && x.fromUserAccount === dep) deployerDumped = true;
  }
  return {
    earlyBuyers: early, earlyTagged: early.filter((a) => tag(a)).length, earlyRugger: early.some((a) => tag(a) === "rugger"),
    coordinated, fresh: [...freshM].map(([wallet, at]) => ({ wallet, at })), bundle, exits: [...exits].map(([wallet, tag]) => ({ wallet, tag })), deployerDumped, txScanned: all.length,
    fromTs: asc[0]!.timestamp * 1000, toTs: asc[asc.length - 1]!.timestamp * 1000, genesis, deployer: dep,
  };
}

/* ---------------- Scanner deep audit: 300 tx flow + L2 origin trace ---------------- */
export interface DeepAudit { flow: FlowIntel | null; txScanned: number; originL1?: string | undefined; originL2?: string; originL2Label?: string; sweepers: { address: string; sources: number; sol: number }[] }
export async function deepAudit(mint: string, c: Cluster | null): Promise<DeepAudit> {
  const flow = await flowIntel(mint, c?.deployer, 10);
  const out: DeepAudit = { flow, txScanned: flow?.txScanned ?? 0, originL1: c?.origin, sweepers: await sweepers(c) };
  if (c?.origin) {
    const g = await firstFunder(c.origin).catch(() => null);
    if (g) { out.originL2 = g.from; out.originL2Label = blacklistLabel(g.from) ?? "Unlabeled wallet"; }
  }
  return out;
}

/** Phase 3 Sweeper engine: follow SOL outflows of cluster members; a destination fed by ≥2 members is a sweeper. */
export async function sweepers(c: Cluster | null) {
  const members = (c?.nodes ?? []).filter((n) => n.level >= 1).slice(0, 10).map((n) => n.id);
  if (members.length < 2) return [];
  const set = new Set([...(c?.nodes ?? []).map((n) => n.id)]);
  const flows: { from: string; to: string; sol: number }[] = [];
  for (const m of members) for (const [to, v] of await outflows(m, 0.05, 10).catch(() => [])) flows.push({ from: m, to, sol: v.sol });
  return findSweepers(flows, set);
}

/* ---------------- Pisces 6: wallet win-rate & PnL over the last 10 traded tokens ---------------- */
interface HSwap { timestamp: number; tokenTransfers?: { fromUserAccount: string; toUserAccount: string; mint: string }[]; accountData?: { account: string; nativeBalanceChange: number; tokenBalanceChanges?: { userAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[] }[] }
export async function trackRecord(addr: string): Promise<WalletPerf | null> {
  const list = await heliusRest<HSwap[]>(`/v0/addresses/${addr}/transactions?limit=100&type=SWAP`);
  if (!list) return null;
  const per = new Map<string, { spent: number; got: number; first: number; lastSell: number }>();
  for (const t of [...list].sort((a, b) => a.timestamp - b.timestamp)) {
    let sol = (t.accountData?.find((a) => a.account === addr)?.nativeBalanceChange ?? 0) / 1e9;
    for (const a of t.accountData ?? []) for (const c of a.tokenBalanceChanges ?? []) if (c.userAccount === addr && c.mint === SOL_MINT) sol += Number(c.rawTokenAmount.tokenAmount) / 10 ** c.rawTokenAmount.decimals;
    const mints = new Set((t.tokenTransfers ?? []).filter((x) => x.mint !== SOL_MINT && (x.toUserAccount === addr || x.fromUserAccount === addr)).map((x) => x.mint));
    if (mints.size !== 1 || !sol) continue;
    const m = [...mints][0]!; const e = per.get(m) ?? { spent: 0, got: 0, first: t.timestamp, lastSell: 0 };
    if (sol < 0) e.spent += -sol; else { e.got += sol; e.lastSell = t.timestamp; }
    per.set(m, e);
  }
  const closed = [...per.values()].filter((e) => e.spent > 0.01 && e.got > 0).sort((a, b) => b.first - a.first).slice(0, 10);
  return { ...classifyPerf(closed.map((e) => ({ roi: e.got / e.spent, holdSec: e.lastSell - e.first }))), at: Date.now() };
}
