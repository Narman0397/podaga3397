import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, Stat } from "@/components/ui-bits";
import { setState, useStore } from "@/lib/store";

export const Route = createFileRoute("/portfolio")({
  head: () => ({ meta: [
    { title: "Portfolio & Settings — Solana Sentinel" },
    { name: "description", content: "Paper trading results, Helius key pool status and alert filters." },
    { property: "og:title", content: "Portfolio & Settings — Solana Sentinel" },
    { property: "og:description", content: "Paper trading, key pool and notification settings." },
  ] }),
  component: Portfolio,
});

function Portfolio() {
  const s = useStore((x) => x);
  const net = s.trades.reduce((a, t) => a + t.pnlSol, 0);
  const wins = s.trades.filter((t) => t.pnlSol > 0).length;
  const avgRoi = s.trades.length ? s.trades.reduce((a, t) => a + t.roi, 0) / s.trades.length : 0;
  let peak = s.equity[0] ?? 10, mdd = 0;
  for (const e of s.equity) { peak = Math.max(peak, e); mdd = Math.max(mdd, (peak - e) / peak); }

  const f = s.alertFilter;
  const setF = (k: keyof typeof f, v: boolean) => setState((st) => ({ alertFilter: { ...st.alertFilter, [k]: v } }));

  return (
    <>
      <PageHeader title="Portfolio & Settings" sub="Paper trading engine · Helius key pool · notifications." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Balance" value={`${s.balance.toFixed(3)} SOL`} />
        <Stat label="Net PnL" value={`${net >= 0 ? "+" : ""}${net.toFixed(3)}`} tone={net >= 0 ? "signal" : "risk"} />
        <Stat label="Win rate" value={s.trades.length ? `${Math.round((wins / s.trades.length) * 100)}%` : "—"} />
        <Stat label="Avg ROI" value={`${avgRoi.toFixed(1)}%`} tone="cyan" />
        <Stat label="Max drawdown" value={`${(mdd * 100).toFixed(1)}%`} tone="warn" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link to="/paper" className="btn">Open positions · TP / trailing stop</Link>
        <span className="chip self-center">{s.positions.length} open</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><div className="label">Helius key pool</div><Link to="/keys" className="btn-ghost !py-1 text-xs">Manage slots</Link></div>
          <div className="font-mono text-sm">{s.keys.filter((k) => k.status === "active").length}/20 active · {s.keys.filter((k) => k.status === "cooldown").length} cooling</div>
          <p className="text-xs text-muted-foreground">Tambah, uji dan kosongkan key Helius dikelola terpusat di halaman Keys.</p>
          <Link to="/keys" className="btn self-start">Kelola key Helius</Link>
        </div>
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><div className="label">Alert filters</div><Link to="/alerts" className="btn-ghost !py-1 text-xs">Telegram / Discord</Link></div>
          {([["A", "Tier A · Safe Play / Re-qualified"], ["B", "Tier B · Cabal Scalp"], ["breakout", "Volume Breakout"]] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[k]} onChange={(e) => setF(k, e.target.checked)} />{l}</label>
          ))}
          <p className="text-xs text-muted-foreground">Dump and risk warnings are always delivered.</p>
        </div>
      </div>
    </>
  );
}
