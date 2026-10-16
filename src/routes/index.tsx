import type { TopTok } from "@/lib/edge";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Search, Flame, Users, TrendingDown, Rocket, ExternalLink, Copy, Check, Zap, ShieldCheck, Siren } from "lucide-react";
import { PageHeader, Progress } from "@/components/ui-bits";
import { pushAlert, setState, useStore, DEFAULT_AUTOBUY, clampSlots, type AutoBuyConfig } from "@/lib/store";
import { saveNow } from "@/lib/cloud-sync";
import { short, fmtUsd } from "@/lib/sim";
import { ScanIntervalSelect } from "@/components/ScanInterval";
import { detectKind, paperBuy, verifyNow, fetchLiveFeed, isPumpFun, autoTraceTiers, autoTraceStats, isPreRaydium, hasElite, autoBuyChecks, runAutoBuy, type FeedToken } from "@/lib/sentinel";
import { getJitoTip, type TipFloor } from "@/lib/market.functions";
import { WalletTag, WALLET_TAG_LABELS } from "@/components/WalletTag";
import { edgeGrade } from "@/lib/edge";
import { usePriceStream } from "@/lib/price-stream";
import { useStream } from "@/lib/stream";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Radar — Solana Sentinel" },
      { name: "description", content: "Live dual-tier Solana token feed: clean launches and cabal scalps with real-time cluster signals." },
      { property: "og:title", content: "Radar — Solana Sentinel" },
      { property: "og:description", content: "Live dual-tier Solana token feed with cluster and dump warnings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Radar,
});

const STATUS: Record<FeedToken["status"], { label: string; cls: string }> = {
  tierA: { label: "Tier A · Safe Play", cls: "text-signal border-signal/40" },
  pending: { label: "Pending Helius Verification", cls: "text-cyan border-cyan/40" },
  tierB: { label: "Tier B · Cabal Scalp", cls: "text-warn border-warn/40" },
  requalified: { label: "Re-Qualified Breakout", cls: "text-cyan border-cyan/40" },
  quarantine: { label: "Quarantine", cls: "text-muted-foreground" },
  rejected: { label: "Rejected", cls: "text-destructive border-destructive/50" },
};

function Radar() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<FeedToken[]>([]);
  const [view, setView] = useState<"A" | "P" | "B" | "Q" | "PF">("A");
  const [size, setSize] = useState(0.5);
  const [imp, setImp] = useState(0);
  const [toast, setToast] = useState("");
  const feedRef = useRef<FeedToken[]>([]);

  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);
  const autoPicked = useRef(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const prev = feedRef.current;
        const next = await fetchLiveFeed(prev, (fast) => {
          if (!alive) return;
          if (!feedRef.current.length) { feedRef.current = fast; setFeed(fast); setLoading(false); }
        });
        if (!alive) return;
        const pm = new Map(prev.map((p) => [p.mint, p]));
        for (const y of next) {
          const x = pm.get(y.mint); if (!x) continue;
          if (y.status !== x.status && (y.status === "requalified" || y.status === "tierB")) pushAlert("buy", `${y.symbol} → ${STATUS[y.status].label}`, y.status === "tierB" ? "B" : "A");
          if (y.intel.rugger && !x.intel.rugger) pushAlert("risk", `🚨 Known Rugger Funder: ${y.symbol}`);
          if (y.intel.coordinated && !x.intel.coordinated) pushAlert("buy", `⚡ Coordinated cabal inflow (≤10m): ${y.symbol}`, "B");
          if (y.intel.mode === "bundle" && x.intel.mode !== "bundle") pushAlert("buy", `💣 Cabal Bundle Launch ${y.symbol}: ${y.intel.cabalWallets + y.intel.watchWallets} wallet ≤${y.intel.bundleSec ?? 30}s`, "B");
          if (y.intel.fresh > 0 && x.intel.fresh === 0 && y.intel.cabalWallets > 0) pushAlert("buy", `⚡ Active Inflow ${y.symbol}: ${y.intel.fresh} wallet pilihan beli ≤15m · skor ${autoBuyChecks(y).score}`, "B");
          if (y.intel.devDump && !x.intel.devDump) pushAlert("dump", `🔻 Dev/cluster exit detected: ${y.symbol}`);
          if (y.intel.cabalWallets >= 2 && x.intel.cabalWallets < 2) pushAlert("buy", `⚡ ${y.intel.cabalWallets} Verified Cabal di ${y.symbol}: ${y.intel.cabalPct}%`, "B");
          if (y.flags.dump && !x.flags.dump) pushAlert("dump", `Dump warning: ${y.symbol} (${short(y.mint)})`);
          if (y.flags.breakout && !x.flags.breakout) pushAlert("info", `Volume breakout ${y.symbol}: ${fmtUsd(y.vol5mUsd)} / 5m`, "breakout");
        }
        feedRef.current = next; setFeed(next);
        if (!autoPicked.current && next.length) {
          autoPicked.current = true;
          const ok = next.filter((t) => t.verified && t.clusterPct !== null);
          const has = (k: string) => k === "PF" ? ok.some((t) => isPreRaydium(t)) : ok.some((t) => k === "A" ? t.status === "tierA" || t.status === "requalified" : k === "B" ? t.status === "tierB" : t.status === "quarantine");
          setView((v) => ((v === "A" || v === "P") && !has(v) ? ((["A", "B", "PF", "Q"] as const).find(has) ?? v) : v));
        }
        void autoTraceTiers(next); void runAutoBuy(next);
      } finally { if (alive) setLoading(false); }
    };
    void load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const [tip, setTip] = useState<TipFloor | null>(null);
  useEffect(() => { const f = () => void getJitoTip().then(setTip).catch(() => {}); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, []);
  const copy = (mint: string) => { void navigator.clipboard.writeText(mint); setCopied(mint); setTimeout(() => setCopied(""), 1500); };

  const go = async () => {
    const v = q.trim(); if (v.length < 32) return;
    setBusy(true);
    const kind = await detectKind(v);
    setBusy(false);
    void nav({ to: "/scanner", search: { addr: v, kind } });
  };

  const buy = async (t: FeedToken) => { setToast("Mengambil harga real…"); const err = await paperBuy(t.mint, size, imp || undefined, t.symbol, t.intel.triggers); setToast(err ?? `✅ Paper buy ${size} SOL of ${t.symbol} filled`); setTimeout(() => setToast(""), 7000); };

  const [checking, setChecking] = useState<Set<string>>(new Set());
  const vNow = async (t: FeedToken) => {
    setChecking((s) => new Set(s).add(t.mint));
    const ok = await verifyNow(t.mint);
    if (!ok) { setToast("⛔ Verifikasi gagal — pastikan ada Helius key aktif."); setTimeout(() => setToast(""), 5000); }
    else { const next = await fetchLiveFeed(feedRef.current); feedRef.current = next; setFeed(next); }
    setChecking((s) => { const n = new Set(s); n.delete(t.mint); return n; });
  };
  const ab = { ...DEFAULT_AUTOBUY, ...useStore((s) => s.autoBuy) };
  const memory = useStore((s) => s.memory);
  const slots = { g: clampSlots(useStore((s) => s.helius?.traceSlotsGeneral), 2), p: clampSlots(useStore((s) => s.helius?.traceSlotsPumpFun), 1) };
  const setAb = (p: Partial<AutoBuyConfig>) => { setState((s) => ({ autoBuy: { ...DEFAULT_AUTOBUY, ...s.autoBuy, ...p } })); saveNow(); };
  // Strict filter: only tokens verified on-chain (mint/freeze authority + holders) are shown.
  const vf = feed.filter((t) => t.verified && t.clusterPct !== null);
  const pendingN = feed.length - vf.length;
  const pf = vf.filter((t) => isPreRaydium(t) && (!ab.cabalOnly || hasElite(t)));
  const counts = { PF: pf.length, A: vf.filter((t) => t.status === "tierA" || t.status === "requalified").length, P: pendingN, B: vf.filter((t) => t.status === "tierB").length, Q: vf.filter((t) => t.status === "quarantine").length };
  const list = view === "PF" ? pf : view === "P" ? [] : vf.filter((t) => view === "A" ? t.status === "tierA" || t.status === "requalified" : view === "B" ? t.status === "tierB" : t.status === "quarantine");

  return (
    <>
      <PageHeader title="Radar" sub="Live feed · fast action. Paste a CA or wallet to scan." />
      <div className="card mb-5 flex gap-2 !p-2">
        <Search className="ml-2 mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <input className="inp !border-0 !bg-transparent" placeholder="Contract address or wallet address…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button className="btn" onClick={go} disabled={busy}>{busy ? "…" : "Scan"}</button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([["A", "Tier A · Safe"], ["P", "⏳ Pending"], ["B", "Tier B · Degen"], ["Q", "Quarantine"], ["PF", "💊 Pre-Raydium Pump.fun"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={view === k ? "btn !py-1.5 text-xs" : "btn-ghost !py-1.5 text-xs"}>{l} ({counts[k]})</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">Size <input className="inp w-20 !py-1" type="number" step="0.1" value={size} onChange={(e) => setSize(+e.target.value)} /> SOL</label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground" title="0 = otomatis (3% AMM likuid, 8% kurva/microcap)">Max impact <input className="inp w-16 !py-1" type="number" step="0.5" value={imp} onChange={(e) => setImp(+e.target.value)} />% {imp ? "" : "(auto)"}</label>
      </div>
      <TopVolumeDaily />
      <p className="mb-3 font-mono text-[11px] text-muted-foreground">🧬 Dual Auto-Trace: DEX ({slots.g} slot) · Pump.fun ({slots.p} slot) | {autoTraceStats.current ? `tracing ${autoTraceStats.current}…` : "idle"} · {autoTraceStats.done} token · {autoTraceStats.saved} wallet tersimpan</p>
      <StreamLine />
      <div className="mb-3"><ScanIntervalSelect compact /></div>
      <details className="mb-4 border-y py-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Wallet bertag ({memory.length})</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          {memory.map((entry) => <div key={entry.address} className="flex flex-wrap items-center gap-2 border-t py-2">
            <span className="font-mono" title={entry.address}>{short(entry.address)}</span>
            <WalletTag entry={entry} />
          </div>)}
        </div>
      </details>
      {view === "PF" && (
        <div className="card mb-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={ab.enabled} onChange={(e) => setAb({ enabled: e.target.checked })} />🤖 Enable AutoBuy (paper)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ab.cabalOnly} onChange={(e) => setAb({ cabalOnly: e.target.checked })} />Hanya Cabal Inflow (matikan = semua Pre-Raydium)</label>
            <label className="flex items-center gap-2 text-signal" title="Beli hanya jika: Verified Cabal ≥1, Active Inflow, Coordinated Bundle / ≥2 early buyer tagged, tanpa cluster exit / Dev Dump / rugger, churner ≤ alpha, Edge ≥70 (Grade A/S)."><input type="checkbox" checked={ab.tagGate !== false} onChange={(e) => setAb({ tagGate: e.target.checked })} />🏆 Golden Setup (gerbang tag)</label>
            <label className="flex items-center gap-2 text-cyan" title="Server worker mengevaluasi & paper-buy tiap interval scan walau browser tertutup. Memakai kuota Helius (cek authority & holders) — butuh login, Helius key, dan modul Cloud Worker ON."><input type="checkbox" checked={ab.background24x7} onChange={(e) => setAb({ background24x7: e.target.checked })} />🌙 24/7 Background AutoBuy (Server Worker)</label>
          </div>
          <div className="flex flex-wrap gap-3">
            {([["onBreakout", "Breakout (vol 5m >$20k & B/S >1.3)"], ["onCabalInflow", `≥2 wallet ${WALLET_TAG_LABELS.cabal} / ${WALLET_TAG_LABELS.watch} ≤10m`], ["onVolumeSurge", "Buy pressure ≥1.5×"], ["onCurveSweetSpot", `Curve ${ab.curveMin}–${ab.curveMax}% (filter)`], ["onSafeOrganic", "Top10 <15%, no rugger/exit (filter)"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={ab[k]} onChange={(e) => setAb({ [k]: e.target.checked })} />{l}</label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-muted-foreground">
            {([["sizeSol", "Size SOL", 0.05], ["maxOpen", "Maks posisi", 1], ["cooldownMin", "Cooldown menit", 1], ["curveMin", "Curve min %", 1], ["curveMax", "Curve max %", 1]] as const).map(([k, l, st]) => (
              <label key={k} className="flex items-center gap-1.5">{l}<input className="inp w-16 !py-1" type="number" step={st} value={ab[k]} onChange={(e) => setAb({ [k]: +e.target.value })} /></label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 border-t border-border pt-2">
            <span className="font-semibold">Filter entry tambahan:</span>
            {([["fMinLiq", "Likuiditas min $", "minLiqUsd", 1000], ["fMcap", "Mcap min $", "mcapMin", 1000], ["fMcap", "Mcap max $", "mcapMax", 1000], ["fMinBuys", "Buys 5m min", "minBuys5m", 1], ["fMaxAge", "Umur maks (menit)", "maxAgeMin", 5], ["fMaxTop10", "Top10 maks %", "maxTop10", 1]] as const).map(([f, l, k, st]) => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={ab[f]} onChange={(e) => setAb({ [f]: e.target.checked })} />{l}<input className="inp w-20 !py-1" type="number" step={st} value={ab[k]} disabled={!ab[f]} onChange={(e) => setAb({ [k]: +e.target.value })} /></label>
            ))}
          </div>
          <p className="text-muted-foreground">Beli jika minimal satu pemicu tercentang terpenuhi dan semua filter lolos. Impact maks 8%, otomatis dipantau tracker (TP & trailing stop). Pemicu cabal butuh Helius key + Cluster Memory.</p>
        </div>
      )}
      {toast && <div className={`card mb-4 font-mono text-sm ${toast.startsWith("⛔") ? "border-destructive/60 text-destructive" : ""}`}>{toast}</div>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">{view === "P" ? `${counts.P} token sedang diverifikasi on-chain — akan muncul setelah lolos.` : loading ? "Loading live Solana tokens…" : "Belum ada token terverifikasi on-chain di tier ini…"}</p>}
        {list.map((t) => (
          <div key={t.mint} className="card space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-semibold">${t.symbol}</div><button onClick={() => copy(t.mint)} className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground" title="Copy CA">{short(t.mint)}{copied === t.mint ? <Check className="h-3 w-3 text-signal" /> : <Copy className="h-3 w-3" />}</button></div>
              <span className={`chip ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {t.flags.breakout && <span className="chip text-signal border-signal/40"><Flame className="h-3 w-3" />Breakout</span>}
              {!t.verified && <span className="chip text-cyan border-cyan/40"><Users className="h-3 w-3" />⏳ Pending Verification</span>}
              <PiscesChips t={t} />
              {t.intel.rugger && <span className="chip text-destructive border-destructive/50"><Siren className="h-3 w-3" />Serial Rugger</span>}
              {t.intel.organic && t.clusterPct !== null && t.clusterPct < 15 && <span className="chip text-signal border-signal/40"><ShieldCheck className="h-3 w-3" />Safe Organic Distribution</span>}
              {t.intel.devDump && <span className="chip text-destructive border-destructive/50">Dev Dump Imminent{t.intel.exits ? ` · ${t.intel.exits} cluster exit` : ""}</span>}
              {t.intel.coordinated && <span className="chip text-warn border-warn/40"><Zap className="h-3 w-3" />Coordinated Inflow ≤10m</span>}
              {t.intel.earlyTagged > 0 && <span className="chip text-warn border-warn/40">{t.intel.earlyTagged} early buyer tagged</span>}
              {t.flags.dump && <span className="chip text-destructive border-destructive/50"><TrendingDown className="h-3 w-3" />Dump warning</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              <div><div className="label">Market cap</div>{Number.isFinite(t.m.mcap) && t.m.mcap > 0 ? fmtUsd(t.m.mcap) : "—"}</div>
              <div><div className="label">B/S 5m</div>{t.buySellRatio}</div>
              <div><div className="label">Top10 hold</div>{t.clusterPct === null ? "—" : `${t.clusterPct}%`}</div>
              <div><div className="label">Vol 5m</div>{fmtUsd(t.vol5mUsd)}</div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><Rocket className="h-3 w-3" />{t.m.migrated ? "Migrated · Raydium" : "Bonding curve"}</span><span>{t.m.curvePct}%</span></div>
              <Progress value={t.m.curvePct} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Jito tip</span><span className="font-mono text-cyan">{tip ? `${tip.recommended.toFixed(6)} SOL` : "—"}</span></div>
            {view === "PF" && (() => { const c = autoBuyChecks(t); return (
              <div className="flex flex-wrap gap-1 text-[10px]">
                {Object.entries(c.hit).map(([k, v]) => <span key={k} className={`chip ${v ? "text-signal border-signal/40" : "text-muted-foreground"}`}>{v ? "✓" : "✗"} {k.replace("on", "")}</span>)}
                <span className="chip text-cyan border-cyan/40">~{(t.m.virtualSol || 0).toFixed(1)}/85 SOL</span>
                <span className={`chip ${c.golden.ok ? "text-signal border-signal/40" : "text-muted-foreground"}`} title={c.golden.fails.join(" · ")}>{c.golden.ok ? "🏆 Golden Setup" : `✗ Golden: ${c.golden.fails[0]}`}</span>
                {c.ok && <span className="chip text-signal border-signal/40">AutoBuy ready</span>}
              </div>); })()}
            <div className="flex gap-2">
              <button className="btn flex-1 !py-1.5 text-xs" onClick={() => buy(t)}>Paper buy</button>
              {!t.verified && <button className="btn-ghost !py-1.5 text-xs text-cyan" disabled={checking.has(t.mint)} onClick={() => vNow(t)}>{checking.has(t.mint) ? "Verifying…" : "Verify Now"}</button>}
              <a className="btn-ghost !py-1.5 text-xs" href={`https://dexscreener.com/solana/${t.mint}`} target="_blank" rel="noreferrer">Dex<ExternalLink className="ml-1 h-3 w-3" /></a>
              {isPumpFun(t.mint, t.dexId)
                ? <a className="btn-ghost !py-1.5 text-xs" href={`https://pump.fun/coin/${t.mint}`} target="_blank" rel="noreferrer">Pump.fun</a>
                : <a className="btn-ghost !py-1.5 text-xs" href={`https://photon-sol.tinyastro.io/en/lp/${t.mint}`} target="_blank" rel="noreferrer">Photon</a>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? "<1m" : `${m}m`; };
/** Master Plan Pisces signal chips: tiering, fresh inflow, attack mode, family tree, track record, calibrated score. */
function PiscesChips({ t }: { t: FeedToken }) {
  const i = t.intel; const n = i.cabalWallets + i.watchWallets;
  const score = autoBuyChecks(t).score; const g = edgeGrade(score);
  return (<>
    {n > 0 && <span className="chip whitespace-normal text-warn border-warn/40"><Zap className="h-3 w-3" />{[i.cabalWallets ? `${i.cabalWallets} Verified Cabal (${i.cabalPct}%)` : "", i.watchWallets ? `${i.watchWallets} Bundler Watch (${i.watchPct}%)` : ""].filter(Boolean).join(" + ")}</span>}
    {i.dust > 0 && <span className="chip text-muted-foreground" title="Kepemilikan <0,5% suplai dan <0,2 SOL tidak dihitung">{i.dust} wallet debu diabaikan</span>}
    {n > 0 && (i.lastInflowAt ? <span className="chip text-signal border-signal/40">⚡ Active Inflow: {ago(i.lastInflowAt)} lalu</span> : <span className="chip text-muted-foreground">💤 Stale Holding</span>)}
    {i.mode === "bundle" && <span className="chip text-warn border-warn/40">💣 Coordinated Bundle (≤{i.bundleSec ?? 30}s)</span>}
    {i.mode === "dca" && <span className="chip text-cyan border-cyan/40">Organic DCA / Bertahap</span>}
    {n >= 2 && i.masters > 0 && <span className="chip text-muted-foreground" title="Dari catatan master funder di Memory">{i.sameMaster ? "🌳 1 master (risiko dump bersama)" : `🌳 ${i.masters} master · multi-cabal`}</span>}
    {i.alpha > 0 && <span className="chip text-signal border-signal/40">🐋 {i.alpha} Alpha Whale</span>}
    {i.churner > 0 && <span className="chip text-destructive border-destructive/50">{i.churner} Toxic Churner</span>}
    {(n > 0 || i.earlyTagged > 0) && <span className={`chip ${g === "S" || g === "A" ? "text-signal border-signal/40" : "text-muted-foreground"}`}>Edge {score} · Grade {g}</span>}
  </>);
}
function StreamLine() {
  const s = useStream(); const ps = usePriceStream();
  return <p className="mb-3 font-mono text-[11px] text-muted-foreground">📡 Live stream cabal: {s.connected ? `aktif · ${s.wallets} wallet · ${s.events.length} event` : "mati (nyalakan di Keys)"}{" · "}⚡ Live harga posisi: {ps.connected ? `aktif · ${ps.pools} pool · ${ps.pushes} update` : "mati"}</p>;
}

const TIER_LBL: Record<string, string> = { tierA: "Tier A", tierB: "Tier B", pending: "Pending", quarantine: "Quarantine", pumpfun: "Pump.fun", rejected: "Ditolak", unverified: "Belum terverifikasi" };
function TopVolumeDaily() {
  const [rows, setRows] = useState<{ t: TopTok; at: number }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void supabase.from("scan_history").select("summary, scanned_at").eq("kind", "topvol").order("scanned_at", { ascending: false }).limit(30).then(({ data }) => {
      setRows((data ?? []).map((r) => { try { return { t: JSON.parse(r.summary) as TopTok, at: Date.parse(r.scanned_at) }; } catch { return null; } }).filter(Boolean).sort((a, b) => b!.t.vol24 - a!.t.vol24) as { t: TopTok; at: number }[]);
    });
  }, []);
  if (!rows.length) return null;
  const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
  return (
    <div className="card mb-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="label">📊 Top Volume Harian ({rows.length})</span>
        <span className="font-mono text-[11px] text-muted-foreground">{new Date(rows[0]!.at).toLocaleString()} {open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="mt-2 space-y-1 font-mono text-xs">{rows.map(({ t }) => (
        <div key={t.mint} className="flex flex-wrap items-center gap-2 border-t border-border pt-1">
          <span className="chip border-primary/40 text-primary">Top Volume Harian</span>
          <span className="font-semibold">${t.symbol}</span>
          <span className="text-muted-foreground">vol {fmt(t.vol24)} · LP {fmt(t.liq)}</span>
          <span className={`chip ${t.tier === "tierA" ? "border-signal/40 text-signal" : t.tier === "rejected" || t.tier === "quarantine" ? "border-destructive/50 text-destructive" : "text-muted-foreground"}`}>{TIER_LBL[t.tier] ?? t.tier}</span>
          <span className="text-muted-foreground">{t.track === "pump" ? "Pump.fun" : "DEX"}</span>
          <Link to="/scanner" search={{ addr: t.mint, kind: "token" }} className="ml-auto text-primary">scan →</Link>
        </div>))}</div>}
    </div>
  );
}
