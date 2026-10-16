import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, Stat } from "@/components/ui-bits";
import { short } from "@/lib/sim";
import { traceForward } from "@/lib/real";
import { heliusOn } from "@/lib/store";
import { heliusRest } from "@/lib/helius";
import { getJitoTip, type TipFloor } from "@/lib/market.functions";
import { pushAlert, setState, useStore } from "@/lib/store";

export const Route = createFileRoute("/signals")({
  head: () => ({ meta: [
    { title: "Signals & Execution — Solana Sentinel" },
    { name: "description", content: "Coordinated buy alerts, dump warnings, Jito tip optimizer and staged take-profit." },
    { property: "og:title", content: "Signals & Execution — Solana Sentinel" },
    { property: "og:description", content: "Cluster signals, anti-MEV and smart exits." },
  ] }),
  component: Signals,
});

function Signals() {
  const g = useStore((s) => s.guard);
  const [master, setMaster] = useState("");
  const [on, setOn] = useState(false);
  const [tip, setTip] = useState<TipFloor | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => { const f = () => void getJitoTip().then(setTip).catch(() => {}); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!on || master.length < 32) return;
    let alive = true; const seen = new Set<string>(); let subs: string[] = [];
    type Tx = { signature: string; timestamp: number; type: string; nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[]; tokenTransfers?: { fromUserAccount: string; toUserAccount: string; mint: string }[] };
    const emit = (kind: "buy" | "dump", msg: string) => { pushAlert(kind, msg); setLog((l) => [msg, ...l].slice(0, 50)); };
    const poll = async (first: boolean) => {
      const buys = new Map<string, { w: Set<string>; t: number }>();
      for (const w of subs) {
        const list = (await heliusRest<Tx[]>(`/v0/addresses/${w}/transactions?limit=20`)) ?? [];
        for (const t of list) {
          if (seen.has(t.signature)) continue; seen.add(t.signature);
          if (first) continue;
          if (t.type === "SWAP") for (const tt of t.tokenTransfers ?? []) if (tt.toUserAccount === w) {
            const b = buys.get(tt.mint) ?? { w: new Set(), t: t.timestamp }; b.w.add(w); buys.set(tt.mint, b);
          }
          for (const n of t.nativeTransfers ?? []) if (n.fromUserAccount === w && n.toUserAccount === master && n.amount > 1e7) emit("dump", `EMERGENCY DUMP: ${short(w)} mengirim ${(n.amount / 1e9).toFixed(2)} SOL balik ke master ${short(master)}`);
          if (t.type === "SWAP" && (t.tokenTransfers ?? []).some((tt) => tt.fromUserAccount === w)) emit("dump", `SELL: ${short(w)} menjual token (${t.signature.slice(0, 8)}…)`);
        }
      }
      buys.forEach((b, mint) => { if (b.w.size >= 2) emit("buy", `COORDINATED BUY: ${b.w.size} sub-wallet ${short(master)} membeli ${short(mint)}`); });
    };
    (async () => {
      try {
        if (!heliusOn("signals")) { setLog((l) => ["Signals tracker OFF di panel kuota Helius", ...l]); return; }
        const cl = await traceForward(master);
        subs = cl.nodes.filter((n) => n.level > 0).map((n) => n.id);
        if (!alive) return;
        setLog((l) => [`Monitoring ${subs.length} sub-wallet real dari ${short(master)}`, ...l]);
        await poll(true);
      } catch (e) { setErr((e as Error).message); setOn(false); }
    })();
    const t = setInterval(() => { if (alive && subs.length) void poll(false); }, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [on, master]);

  // staged exit illustration
  const path = [1, 1.4, 2.1, 2.6, 3.2, 2.9, 2.5, 2.3];
  let ath = 1, secured = false;
  const steps = path.map((p) => {
    ath = Math.max(ath, p);
    const ev = !secured && p >= 1 + g.tp1 / 100 ? ((secured = true), "sell 50% · principal secured") : secured && p <= ath * (1 - g.trail / 100) ? "trailing stop hit · exit" : "";
    return { p, ath, ev };
  });

  return (
    <>
      <PageHeader title="Signals, Anti-MEV & Smart Execution" sub="Watch a cluster master for coordinated buys and dumps; protect fills with Jito bundles." />
      <div className="card mb-6 flex flex-wrap gap-3">
        <input className="inp flex-1" placeholder="Cluster master wallet to monitor" value={master} onChange={(e) => setMaster(e.target.value)} />
        <button className={on ? "btn-ghost" : "btn"} onClick={() => setOn(!on)}>{on ? "Stop monitor" : "Start monitor"}</button>
      </div>
      {err && <div className="card mb-4 text-sm text-warn">{err}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${on ? "bg-signal animate-pulse" : "bg-muted-foreground"}`} /><div className="label">Signal feed</div></div>
          <div className="h-72 space-y-1.5 overflow-y-auto font-mono text-xs">
            {log.length === 0 && <p className="py-10 text-center text-muted-foreground">Start the monitor to stream cluster signals.</p>}
            {log.map((l, i) => <div key={i} className={`rounded border px-2 py-1.5 ${l.startsWith("COORD") ? "border-signal/30 text-signal" : l.startsWith("Monitoring") ? "text-muted-foreground" : "border-destructive/40 text-destructive"}`}>{l}</div>)}
          </div>
        </div>
        <div className="card space-y-3">
          <div className="label">Jito dynamic tip</div>
          {(["p25", "p50", "p75", "p95"] as const).map((k) => (
            <div key={k} className="flex justify-between font-mono text-sm"><span className="text-muted-foreground">{k}</span><span>{tip ? tip[k].toFixed(6) : "—"}</span></div>
          ))}
          <div className="rounded-lg border border-cyan/40 bg-cyan/10 p-3">
            <div className="text-xs text-muted-foreground">Recommended (anti-sandwich)</div>
            <div className="font-mono text-xl text-cyan">{tip ? `${tip.recommended.toFixed(6)} SOL` : "—"}</div>
          </div>
          <div className="text-xs text-muted-foreground">Data tip landed Jito real (p75) · {tip ? new Date(tip.at).toLocaleTimeString() : "memuat"}</div>
        </div>
      </div>
      <div className="card mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="label">Staged take-profit & trailing stop</div>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2">TP1 +<input className="inp w-20" type="number" value={g.tp1} onChange={(e) => setState((s) => ({ guard: { ...s.guard, tp1: +e.target.value } }))} />%</label>
            <label className="flex items-center gap-2">Trail −<input className="inp w-20" type="number" value={g.trail} onChange={(e) => setState((s) => ({ guard: { ...s.guard, trail: +e.target.value } }))} />%</label>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
          {steps.map((s, i) => (
            <div key={i} className={`rounded-lg border p-2 text-center ${s.ev ? "border-signal/40 bg-signal/10" : "bg-surface/60"}`}>
              <div className="font-mono text-sm">{s.p.toFixed(1)}x</div>
              <div className="text-[10px] text-muted-foreground">ATH {s.ath.toFixed(1)}x</div>
              {s.ev && <div className="mt-1 text-[10px] text-signal">{s.ev}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Buy trigger" value="≥ 2 sub-wallets" tone="signal" />
        <Stat label="Dump trigger" value="→ pool / → master" tone="risk" />
        <Stat label="Principal lock" value={`at +${g.tp1}%`} tone="cyan" />
      </div>
    </>
  );
}
