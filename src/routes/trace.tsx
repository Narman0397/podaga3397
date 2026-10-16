import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Stat } from "@/components/ui-bits";
import { FlowGraph } from "@/components/FlowGraph";
import { short, type Cluster } from "@/lib/sim";
import { traceForward, traceReverse } from "@/lib/real";
import { blacklistLabel, getState, memoryTag, pushAlert, setState, useStore } from "@/lib/store";
import { WalletTag, WALLET_TAG_LABELS } from "@/components/WalletTag";

export const Route = createFileRoute("/trace")({
  head: () => ({ meta: [
    { title: "Dual-Direction Tracing — Solana Sentinel" },
    { name: "description", content: "Forward wallet tracing and reverse contract-address cluster scanning on Solana." },
    { property: "og:title", content: "Dual-Direction Tracing — Solana Sentinel" },
    { property: "og:description", content: "Map Master → L1 → L2 fund flows and launch clusters." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Trace,
});

function Trace() {
  useStore((s) => s.memory);
  const [mode, setMode] = useState<"forward" | "reverse">("reverse");
  const [input, setInput] = useState("");
  const [c, setC] = useState<Cluster | null>(null);
  const [filtered, setFiltered] = useState(0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    const v = input.trim();
    if (v.length < 32) return;
    const bl = blacklistLabel(v);
    if (bl) { pushAlert("info", `Trace aborted: ${short(v)} is ${bl} (CEX/Disperse filter)`); return; }
    setBusy(true); setErr("");
    let cl: Cluster;
    try { cl = mode === "forward" ? await traceForward(v) : await traceReverse(v); }
    catch (e) { setErr((e as Error).message); setBusy(false); return; }
    setBusy(false);
    const before = cl.nodes.length;
    cl.nodes = cl.nodes.filter((n) => !blacklistLabel(n.id));
    setFiltered(before - cl.nodes.length);
    setC(cl);
    const cap = getState().guard.clusterCap;
    if (cl.funder && cl.totalSupplyPct > cap) pushAlert("risk", `Cluster ${short(cl.funder)} holds ${cl.totalSupplyPct}% supply (> ${cap}%) — high dump risk`);
    if (cl.funder && cl.bundleScore > 70) pushAlert("risk", `Dev bundle detected (${cl.bundleScore}/100) from ${short(cl.funder)}`);
  };

  const tag = (id: string) => {
    const t = prompt(`Tag wallet:\nrugger = ${WALLET_TAG_LABELS.rugger}\ncabal = ${WALLET_TAG_LABELS.cabal}\nwatch = ${WALLET_TAG_LABELS.watch}`, "watch") as "rugger" | "cabal" | "watch" | null;
    if (!t || !["rugger", "cabal", "watch"].includes(t)) return;
    setState((s) => ({ memory: [{ address: id, tag: t, note: c ? `From cluster ${short(c.funder!)}` : "", seen: 1, at: Date.now() }, ...s.memory.filter((m) => m.address !== id)] }));
  };

  const cap = getState().guard.clusterCap;
  return (
    <>
      <PageHeader title="Dual-Direction Tracing Engine" sub="Forward: Master → Child L1 → Sub-wallet L2. Reverse: CA → Deployer → Master Funder → launch buyers." />
      <div className="card mb-6 flex flex-wrap gap-3">
        <div className="flex rounded-lg border bg-surface p-1">
          {(["forward", "reverse"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-md px-4 py-1.5 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {m === "forward" ? "Forward · Wallet" : "Reverse · CA Scanner"}
            </button>
          ))}
        </div>
        <input className="inp flex-1" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()}
          placeholder={mode === "forward" ? "Master wallet address" : "Token contract address (mint)"} />
        <button className="btn" disabled={busy} onClick={() => void run()}>{busy ? "Tracing…" : "Trace"}</button>
      </div>

      {err && <div className="card mb-4 text-sm text-warn">{err}</div>}
      {!c && <div className="card py-16 text-center text-muted-foreground">Enter an address (≥32 chars) to map the cluster.</div>}
      {c && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Cluster supply" value={`${c.totalSupplyPct}%`} tone={c.totalSupplyPct > cap ? "risk" : "signal"} />
            <Stat label="Bundle score" value={`${c.bundleScore}/100`} tone={c.bundleScore > 70 ? "risk" : "cyan"} />
            <Stat label="Funding uniformity" value={`${c.uniformity}%`} />
            <Stat label="Funding window" value={`${c.windowSec}s`} tone={c.windowSec < 120 ? "warn" : undefined} />
          </div>
          {c.totalSupplyPct > cap && (
            <div className="mb-4 rounded-xl border border-destructive/60 bg-destructive/15 p-4 text-sm font-semibold text-destructive">
              ⚠ HIGH DUMP RISK — cluster controls {c.totalSupplyPct}% of supply (cap {cap}%).
            </div>
          )}
          <FlowGraph cluster={c} onSelect={tag} />
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="card space-y-2 text-sm">
              <div className="label mb-2">Lineage</div>
              {c.deployer && <Row k="Deployer" v={short(c.deployer)} />}
              <Row k="Master funder" v={c.funder ? short(c.funder) : "tidak ada cluster"} />
              <Row k="Origin (1 hop back)" v={c.origin ? `${short(c.origin)} · ${c.originLabel}` : "—"} />
              <Row k="CEX/Disperse filtered" v={String(filtered)} />
            </div>
            <div className="card lg:col-span-2">
              <div className="label mb-2">Wallets ({c.nodes.length})</div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full font-mono text-xs">
                  <thead className="text-muted-foreground"><tr><th className="py-1 text-left">Address</th><th>Lvl</th><th>SOL</th><th>Supply</th><th>Memory</th></tr></thead>
                  <tbody>
                    {c.nodes.map((n) => { const m = memoryTag(n.id); return (
                      <tr key={n.id} className="border-t"><td className="py-1.5">{short(n.id)}</td><td className="text-center">L{n.level}</td>
                        <td className="text-center">{n.sol}</td><td className={`text-center ${n.supplyPct ? "text-signal" : ""}`}>{n.supplyPct || "—"}%</td>
                        <td className="text-center">{m ? <WalletTag entry={m} /> : "—"}</td></tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (<div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="font-mono">{v}</span></div>);
