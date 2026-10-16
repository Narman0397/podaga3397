import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Check, PageHeader, Stat } from "@/components/ui-bits";
import { FlowGraph } from "@/components/FlowGraph";
import { short, fmtUsd, type Cluster } from "@/lib/sim";
import { heliusOn } from "@/lib/store";
import { fetchMarket, traceForward, traceReverse, deepAudit, type RealMarket, type DeepAudit } from "@/lib/real";
import { analyzeScan } from "@/lib/ai-analysis.functions";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { recordScan, setState, useStore, memoryTag, autoSaveCluster, type MemoryEntry } from "@/lib/store";
import { WalletTag, WALLET_TAG_LABELS } from "@/components/WalletTag";

export const Route = createFileRoute("/scanner")({
  validateSearch: z.object({ addr: z.string().optional(), kind: z.enum(["token", "wallet"]).optional() }),
  head: () => ({ meta: [
    { title: "Scanner & Tree — Solana Sentinel" },
    { name: "description", content: "Reverse CA audit, forward wallet tree, cluster memory tags and scan history." },
    { property: "og:title", content: "Scanner & Tree — Solana Sentinel" },
    { property: "og:description", content: "Deep token audit and wallet flow tree for Solana." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Scanner,
});

const TAGS: { v: MemoryEntry["tag"]; l: string }[] = ["rugger", "cabal", "watch"].map((v) => ({ v: v as MemoryEntry["tag"], l: WALLET_TAG_LABELS[v as MemoryEntry["tag"]] }));

function Scanner() {
  const { addr, kind } = Route.useSearch();
  const nav = useNavigate();
  const history = useStore((s) => s.scanHistory);
  useStore((s) => s.memory);
  const autoSave = useStore((s) => s.autoSaveCluster);
  const [saved, setSaved] = useState(0);
  const [input, setInput] = useState(addr ?? "");
  const [mode, setMode] = useState<"token" | "wallet">(kind ?? "token");
  const [c, setC] = useState<Cluster | null>(null);
  const [m, setM] = useState<RealMarket | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [deep, setDeep] = useState<DeepAudit | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [ai, setAi] = useState<{ text?: string; err?: string; busy?: boolean }>({});
  const analyze = useServerFn(analyzeScan);
  const runAi = async () => {
    if (!addr) return;
    setAi({ busy: true });
    const tags = c ? c.nodes.map((n) => ({ w: n.id, tag: memoryTag(n.id)?.tag })).filter((x) => x.tag) : [];
    const scan = JSON.stringify({ market: m, cluster: c && { ...c, nodes: c.nodes.slice(0, 40), edges: c.edges.slice(0, 60) }, deepAudit: deep, dbTags: tags }).slice(0, 38000);
    try {
      const r = await analyze({ data: { address: addr, kind: kind ?? mode, scan } });
      setAi(r.error ? { err: r.error } : { text: r.text ?? "" });
    } catch (e) { setAi({ err: (e as Error).message }); }
  };

  const run = async (a: string, k: "token" | "wallet") => {
    if (a.length < 32) return;
    setBusy(true); setErr(""); setSaved(0); setC(null); setM(null); setSel(null); setDeep(null); setAi({});
    try {
      if (k === "token") {
        const [mk, cl] = await Promise.all([fetchMarket(a), (heliusOn("scannerTrace") ? traceReverse(a) : Promise.reject(new Error("Scanner tracing OFF di panel kuota Helius"))).catch((e: Error) => { setErr(e.message); return null; })]);
        setM(mk); setC(cl); if (cl) setSaved(autoSaveCluster(cl, a));
        if (heliusOn("scannerDeep")) { setDeepBusy(true); void deepAudit(a, cl).then(setDeep).catch(() => {}).finally(() => setDeepBusy(false)); }
        recordScan({ address: a, kind: k, summary: cl ? `Bundle ${cl.bundleScore} · cluster ${cl.totalSupplyPct}%` : mk ? `${mk.symbol} · LP ${fmtUsd(mk.liquidityUsd)}` : "tidak ditemukan" });
      } else {
        if (!heliusOn("scannerTrace")) throw new Error("Scanner tracing OFF di panel kuota Helius");
        const cl = await traceForward(a);
        setC(cl); setSaved(autoSaveCluster(cl, a));
        recordScan({ address: a, kind: k, summary: `${cl.nodes.length - 1} child wallets (real)` });
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  useEffect(() => { if (addr) { setInput(addr); setMode(kind ?? "token"); void run(addr, kind ?? "token"); } }, [addr, kind]);

  const submit = () => void nav({ to: "/scanner", search: { addr: input.trim(), kind: mode } });
  const tag = (t: MemoryEntry["tag"]) => sel && setState((s) => ({ memory: [{ address: sel, tag: t, note: "", seen: 1, at: Date.now() }, ...s.memory.filter((x) => x.address !== sel)] }));
  const selNode = c?.nodes.find((n) => n.id === sel);
  const selectedTag = selNode ? memoryTag(selNode.id) : undefined;
  const lpOk = m ? m.migrated && m.liquidityUsd > 15000 : false;

  return (
    <>
      <PageHeader title="Scanner & Tree" sub="Reverse CA audit · forward wallet tree · cluster memory." right={<Link to="/memory" className="btn-ghost text-xs">Full memory</Link>} />
      <div className="card mb-5 flex flex-wrap gap-2 !p-2">
        <select className="inp w-auto" value={mode} onChange={(e) => setMode(e.target.value as "token")}><option value="token">Token (reverse)</option><option value="wallet">Wallet (forward)</option></select>
        <input className="inp flex-1" placeholder="Address…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className="btn" onClick={submit}>Scan</button>
      </div>

      <label className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={autoSave} onChange={(e) => setState(() => ({ autoSaveCluster: e.target.checked }))} />Auto-save discovered clusters to Cloud Database{saved > 0 && <span className="chip text-signal border-signal/40">{saved} wallet tersimpan</span>}</label>
      {(c || m) && !busy && (
        <div className="card mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {mode === "token" && (deepBusy ? <span className="chip text-cyan border-cyan/40">Deep audit berjalan… (300 tx + L2)</span>
              : deep && <span className={`chip ${deep.flow?.genesis ? "text-signal border-signal/40" : "text-warn border-warn/40"}`}>Deep Audit · {deep.txScanned} tx · {deep.flow ? `${new Date(deep.flow.fromTs).toLocaleString()} → ${new Date(deep.flow.toTs).toLocaleTimeString()}` : "—"} · {deep.flow?.genesis ? "sejak peluncuran" : "awal peluncuran tidak terbaca"}</span>)}
            <button className="btn ml-auto !py-1.5 text-xs" onClick={runAi} disabled={ai.busy || deepBusy}><Sparkles className="mr-1 h-3.5 w-3.5" />{ai.busy ? "Menganalisis…" : "AI Intelligence Summary"}</button>
          </div>
          {deep && (
            <div className="grid gap-2 font-mono text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><div className="label">{deep.flow?.genesis ? "Early buyers (genesis)" : "Pembeli tertua yang terbaca"}</div>{deep.flow?.earlyBuyers.length ?? "—"} · {deep.flow?.earlyTagged ?? 0} tagged</div>
              <div><div className="label">Coordinated ≤10m</div>{deep.flow?.coordinated ? `${deep.flow.coordinated.wallets.length} wallets / ${deep.flow.coordinated.windowMin}m` : "tidak"}</div>
              <div><div className="label">Exits 15m</div>{deep.flow?.exits.length ?? 0}{deep.flow?.deployerDumped ? " · dev dumped" : ""}</div>
              <div><div className="label">Origin L1 → L2</div>{deep.originL1 ? short(deep.originL1) : "tanpa cluster"} → {deep.originL2 ? `${short(deep.originL2)} (${deep.originL2Label})` : "—"}</div>
            </div>
          )}
          {deep && (
            <div className="font-mono text-xs">
              <div className="label">Sweeper (penampung keluaran cluster)</div>
              {deep.sweepers.length === 0 ? <span className="text-muted-foreground">{c && c.nodes.length > 1 ? "tidak ada wallet penampung bersama" : "butuh cluster ≥2 wallet"}</span>
                : deep.sweepers.slice(0, 5).map((w) => <div key={w.address}><Link to="/scanner" search={{ addr: w.address, kind: "wallet" }} className="underline">{short(w.address)}</Link> · dari {w.sources} wallet · {w.sol} SOL</div>)}
            </div>
          )}
          {c?.skipped && c.skipped.length > 0 && (
            <div className="font-mono text-xs">
              <div className="label">Holder dikecualikan</div>
              {c.skipped.map((h) => <div key={h.owner}>{short(h.owner)} · {h.pct}% · {h.reason}</div>)}
            </div>
          )}
          {ai.err && <div className="text-sm text-destructive">{ai.err}</div>}
          {ai.text && (
            <div className="rounded-lg border bg-surface/60 p-3">
              {(() => { const v = ai.text.match(/VERDICT:\s*([A-Z\- /]+)/)?.[1]?.trim(); return v ? <span className={`chip mb-2 ${v.startsWith("SAFE") ? "text-signal border-signal/40" : v.startsWith("HIGH") ? "text-warn border-warn/40" : "text-destructive border-destructive/50"}`}>{v}</span> : null; })()}
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{ai.text}</pre>
            </div>
          )}
        </div>
      )}
      {busy && <div className="card mb-4 text-sm text-muted-foreground">Mengambil data on-chain real…</div>}
      {err && <div className="card mb-4 text-sm text-warn">{err}</div>}
      {m && !c && (
        <div className="card mb-4 grid gap-2 md:grid-cols-3">
          <Check ok={m.mintAuthority === null} label="Mint authority" detail={m.mintAuthority === undefined ? "belum terverifikasi" : m.mintAuthority ? short(m.mintAuthority) : "disabled"} />
          <Check ok={m.freezeAuthority === null} label="Freeze authority" detail={m.freezeAuthority === undefined ? "belum terverifikasi" : m.freezeAuthority ? short(m.freezeAuthority) : "disabled"} />
          <Check ok={m.liquidityUsd >= 15000} label="Liquidity" detail={`${fmtUsd(m.liquidityUsd)} · ${m.dexId}`} />
        </div>
      )}
      {c && c.nodes.length === 0 && <div className="card mb-4 text-sm text-muted-foreground">Tidak ditemukan cluster: holder teratas tidak berbagi funder yang sama.</div>}
      {c && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Bundle score" value={c.bundleScore} tone={c.bundleScore >= 60 ? "risk" : c.bundleScore >= 30 ? "warn" : "signal"} />
            <Stat label="Cluster supply" value={`${c.totalSupplyPct}%`} tone={c.totalSupplyPct >= 15 ? "risk" : "signal"} />
            <Stat label="Funding window" value={`${c.windowSec}s`} tone="cyan" />
            <Stat label="Uniformity" value={`${c.uniformity}%`} tone={c.uniformity > 85 ? "warn" : undefined} />
          </div>
          {m && (
            <div className="card space-y-2">
              <div className="label mb-1">Contract status · on-chain</div>
              <div className="grid gap-2 md:grid-cols-3">
                <Check ok={m.mintAuthority === null} label="Mint authority" detail={m.mintAuthority === undefined ? "belum terverifikasi" : m.mintAuthority ? short(m.mintAuthority) : "disabled"} />
                <Check ok={m.freezeAuthority === null} label="Freeze authority" detail={m.freezeAuthority === undefined ? "belum terverifikasi" : m.freezeAuthority ? short(m.freezeAuthority) : "disabled"} />
                <Check ok={lpOk} label="Liquidity (DEX)" detail={m.migrated ? `${fmtUsd(m.liquidityUsd)} · ${m.dexId}` : "on bonding curve"} />
              </div>
            </div>
          )}
          <div className="card">
            <div className="label mb-3">Wallet flow tree · click a wallet</div>
            <FlowGraph cluster={c} onSelect={setSel} />
            {selNode && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-surface/60 p-3 text-sm">
                <span className="font-mono">{short(selNode.id)}</span>
                <span className="text-muted-foreground">{selNode.sol} SOL · {selNode.supplyPct}% supply</span>
                {selectedTag && <WalletTag entry={selectedTag} />}
                <div className="ml-auto flex flex-wrap gap-1">{TAGS.map((t) => <button key={t.v} className="btn-ghost !py-1 text-xs" onClick={() => tag(t.v)}>{t.l}</button>)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card mt-5">
        <div className="mb-2 flex items-center justify-between"><div className="label">Scan history</div>{history.length > 0 && <button className="btn-ghost !py-1 text-xs" onClick={() => setState(() => ({ scanHistory: [] }))}>Clear</button>}</div>
        {history.length === 0 && <p className="text-sm text-muted-foreground">No scans yet.</p>}
        <div className="space-y-1.5">
          {history.map((h) => (
            <Link key={h.address} to="/scanner" search={{ addr: h.address, kind: h.kind }} className="flex items-center gap-3 rounded-lg border bg-surface/60 px-3 py-2 text-sm hover:bg-accent">
              <span className="chip">{h.kind}</span><span className="font-mono">{short(h.address)}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">{h.summary}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{new Date(h.at).toLocaleTimeString()}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
