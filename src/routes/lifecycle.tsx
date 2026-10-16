import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader, Progress, Stat } from "@/components/ui-bits";
import { fmtUsd } from "@/lib/sim";
import { fetchMarket, type RealMarket } from "@/lib/real";
import { pushAlert } from "@/lib/store";

export const Route = createFileRoute("/lifecycle")({
  head: () => ({ meta: [
    { title: "Pump.fun Lifecycle — Solana Sentinel" },
    { name: "description", content: "Real-time bonding curve tracking and Raydium migration alerts." },
    { property: "og:title", content: "Pump.fun Lifecycle — Solana Sentinel" },
    { property: "og:description", content: "Bonding curve progress and Raydium migration alerts." },
  ] }),
  component: Lifecycle,
});

function Lifecycle() {
  const [mint, setMint] = useState("");
  const [track, setTrack] = useState("");
  const [m, setM] = useState<RealMarket | null>(null);
  const [err, setErr] = useState("");
  const wasCurve = useRef<boolean | null>(null);

  useEffect(() => {
    if (!track) return;
    let alive = true;
    const run = async () => {
      const x = await fetchMarket(track);
      if (!alive) return;
      if (!x) { setErr("Token tidak ditemukan di DEX"); return; }
      setErr("");
      if (wasCurve.current === true && x.migrated) pushAlert("migration", `${x.symbol} menyelesaikan bonding curve → migrasi ke ${x.dexId}`);
      wasCurve.current = !x.migrated;
      setM(x);
    };
    void run();
    const t = setInterval(run, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [track]);


  return (
    <>
      <PageHeader title="Pump.fun Lifecycle & Market Dynamics" sub="Track bonding curve 0→100%, catch the Raydium migration, and switch liquidity models automatically." />
      <div className="card mb-6 flex gap-3">
        <input className="inp" placeholder="Pump.fun token mint" value={mint} onChange={(e) => setMint(e.target.value)} />
        <button className="btn" onClick={() => { if (mint.trim().length >= 32) { wasCurve.current = null; setM(null); setTrack(mint.trim()); } }}>Track</button>
      </div>
      {err && <div className="card mb-4 text-sm text-warn">{err}</div>}
      {m && (
        <>
          <div className="card mb-4">
            <div className="flex items-center justify-between">
              <div><div className="label">Bonding curve · ${m.symbol}</div><div className="mt-1 font-mono text-4xl font-semibold">{m.curvePct.toFixed(1)}%</div></div>
              <span className={`chip text-sm ${m.migrated ? "border-cyan/50 text-cyan" : "border-primary/50 text-primary"}`}>{m.migrated ? m.dexId.toUpperCase() : "PUMP.FUN CURVE"}</span>
            </div>
            <div className="mt-4"><Progress value={m.curvePct} /></div>
            <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground"><span>0%</span><span>Migrasi @ 100% (~85 SOL)</span></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Price" value={`$${m.price.toPrecision(3)}`} />
            <Stat label="Market cap" value={fmtUsd(m.mcap)} tone="cyan" />
            <Stat label={m.migrated ? "Raydium LP" : "Virtual liquidity"} value={fmtUsd(m.liquidityUsd)} />
            <Stat label="Liquidity model" value={m.migrated ? "x·y=k pool" : "virtual curve"} tone="warn" />
          </div>
          <div className="card mt-4 font-mono text-xs text-muted-foreground">
            {m.migrated ? `Likuiditas = cadangan pool ${m.dexId} real (${m.solPooled?.toFixed(2) ?? "—"} SOL). Update tiap 10 detik.`
              : `SOL di curve: ${m.virtualSol.toFixed(2)} / ~85 SOL · token di curve: ${(m.virtualTokens / 1e6).toFixed(1)}M. Update tiap 10 detik.`}
          </div>
        </>
      )}
    </>
  );
}
