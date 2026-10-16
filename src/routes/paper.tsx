import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Stat } from "@/components/ui-bits";
import { short } from "@/lib/sim";
import { closePosition as close, proceeds, refreshNow, useTracker } from "@/lib/tracker";
import { paperBuy } from "@/lib/sentinel";
import { resetState, useStore } from "@/lib/store";

export const Route = createFileRoute("/paper")({
  head: () => ({ meta: [
    { title: "Paper Trading — Solana Sentinel" },
    { name: "description", content: "Virtual 10 SOL portfolio with slippage-aware simulated execution and analytics." },
    { property: "og:title", content: "Paper Trading — Solana Sentinel" },
    { property: "og:description", content: "Test strategies risk-free with a virtual portfolio." },
  ] }),
  component: Paper,
});

function Paper() {
  const s = useStore((x) => x);
  const [mint, setMint] = useState(""); const [size, setSize] = useState(0.5); const [slipTol, setSlipTol] = useState(0);
  const [msg, setMsg] = useState("");
  const tr = useTracker(); const q = tr.quotes; const sol = tr.sol; const updated = tr.updated;
  const stale = s.positions.filter((p) => p.ath > 0 && p.entry > 0 && p.ath / p.entry > 1000);

  const buy = async () => {
    const v = mint.trim(); if (v.length < 32) return;
    setMsg("Mengambil harga & quote real…");
    const err = await paperBuy(v, size, slipTol || undefined);
    // symbol resolved from DexScreener inside paperBuy
    setMsg(err ?? `Buy ${size} SOL terisi di harga pasar real`);
  };

  const wins = s.trades.filter((t) => t.pnlSol > 0).length;
  const avgRoi = s.trades.length ? s.trades.reduce((a, t) => a + t.roi, 0) / s.trades.length : 0;
  const net = s.trades.reduce((a, t) => a + t.pnlSol, 0);
  let peak = s.equity[0] ?? 10, mdd = 0;
  for (const e of s.equity) { peak = Math.max(peak, e); mdd = Math.max(mdd, (peak - e) / peak); }
  const max = Math.max(...s.equity), min = Math.min(...s.equity);
  const pts = s.equity.map((e, i) => `${(i / Math.max(1, s.equity.length - 1)) * 100},${40 - ((e - min) / (max - min || 1)) * 36}`).join(" ");

  return (
    <>
      <PageHeader title="Paper Trading" sub="Virtual portfolio · harga DexScreener real · impact Jupiter · PnL setelah fee & impact jual." right={<button className="btn-ghost" onClick={() => confirm("Reset all app data to defaults?") && resetState()}>Reset</button>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Balance" value={`${s.balance.toFixed(3)}`} tone="cyan" />
        <Stat label="Win rate" value={s.trades.length ? `${Math.round((wins / s.trades.length) * 100)}%` : "—"} />
        <Stat label="Avg ROI" value={`${avgRoi.toFixed(1)}%`} tone={avgRoi >= 0 ? "signal" : "risk"} />
        <Stat label="Max drawdown" value={`${(mdd * 100).toFixed(1)}%`} tone="warn" />
        <Stat label="Net PnL (SOL)" value={`${net >= 0 ? "+" : ""}${net.toFixed(3)}`} tone={net >= 0 ? "signal" : "risk"} />
      </div>
      <div className="card mt-4">
        <div className="label mb-2">Equity curve</div>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-28 w-full"><polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" /></svg>
      </div>
      <div className="card mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 text-sm">Token mint<input className="inp mt-1" value={mint} onChange={(e) => setMint(e.target.value)} /></label>
        <label className="w-28 text-sm">Size (SOL)<input className="inp mt-1" type="number" step="0.1" value={size} onChange={(e) => setSize(+e.target.value)} /></label>
        <label className="w-28 text-sm">Max impact % (0=auto)<input className="inp mt-1" type="number" value={slipTol} onChange={(e) => setSlipTol(+e.target.value)} /></label>
        <button className="btn" onClick={() => void buy()}>Buy (harga real)</button>
        {msg && <div className={`w-full font-mono text-xs ${msg.startsWith("⛔") ? "text-destructive" : "text-muted-foreground"}`}>{msg}</div>}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <div className="label flex items-center gap-2">Open positions
              {updated > 0 && <span key={tr.tick} className="inline-block h-2 w-2 animate-ping rounded-full bg-signal" />}
              {updated ? <span className="font-mono normal-case">{new Date(updated).toLocaleTimeString()}</span> : null}
            </div>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void refreshNow()}>Refresh harga</button>
          </div>
          {tr.error && <p className="mb-2 font-mono text-xs text-destructive">{tr.error}</p>}
          {stale.length > 0 && <p className="mb-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{stale.length} posisi tampak dibuka dengan harga lama/simulasi. Jual atau tekan Reset.</p>}
          {s.positions.length === 0 && <p className="text-sm text-muted-foreground">None. Coba token Tier B di Radar — volumenya tinggi sehingga harga bergerak.</p>}
          {s.positions.map((p) => { const x = q[p.token]; const val = x && sol ? proceeds(p, x.price, sol, x.liq) : null; const pnl = val === null ? null : (val / p.sizeSol - 1) * 100; return (
            <div key={p.id} className="border-t py-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Ticker symbol={p.symbol} mint={p.token} />{p.securedPrincipal && <span className="chip ml-1 text-signal">secured</span>}</span>
                <span>{p.sizeSol.toFixed(2)} SOL</span>
                <span className={pnl === null ? "text-muted-foreground" : pnl >= 0 ? "text-signal" : "text-destructive"}>{pnl === null ? "menunggu harga" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`}</span>
                <button className="btn-ghost !px-2 !py-1" disabled={!x || !sol} onClick={() => x && close(p, x.price, sol, x.liq, "Manual sell")}>Sell</button>
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
                <span>Entry ${p.entry.toPrecision(4)}</span>
                <span>Now {x ? `$${x.price.toPrecision(4)}` : "—"}</span>
                {x && <span>src {x.src}</span>}
              </div>
            </div>); })}
        </div>
        <div className="card">
          <div className="label mb-2">Closed trades</div>
          <div className="max-h-64 overflow-y-auto">
            {s.trades.map((t) => (
              <div key={t.id} className="flex justify-between border-t py-1.5 font-mono text-xs">
                <Ticker symbol={t.symbol} mint={t.token} /><span className="text-muted-foreground">{t.reason}</span>
                <span className={t.pnlSol >= 0 ? "text-signal" : "text-destructive"}>{t.pnlSol >= 0 ? "+" : ""}{t.pnlSol.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Ticker({ symbol, mint }: { symbol?: string | undefined; mint: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {symbol && <span className="font-sans font-semibold text-foreground">${symbol.toUpperCase()}</span>}
      <button type="button" title="Copy CA" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => void navigator.clipboard.writeText(mint)}>{symbol ? `(${short(mint)})` : short(mint)}</button>
    </span>
  );
}
