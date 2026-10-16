import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui-bits";
import { WieStatus } from "@/components/WieStatus";
import { neighbourhood } from "@/lib/wallet-intelligence/graph";
import { short } from "@/lib/sim";

export const Route = createFileRoute("/wie")({
  head: () => ({ meta: [
    { title: "Wallet Intelligence — Solana Sentinel" },
    { name: "description", content: "Ringkasan WIE: keputusan gate, relasi wallet berbukti, detail wallet, dan backtest temporal." },
    { property: "og:title", content: "Wallet Intelligence — Solana Sentinel" },
    { property: "og:description", content: "Gate, wallet graph, wallet detail and temporal backtest." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: WiePage,
});

type Sig = { id: string; wallet: string; mint: string; signal_at: string; delay_sec: number | null; liquidity_usd: number | null; entry_status: string; risk_score: number | null; gate_decision: string | null; gate: { reasons?: string[]; overall_score?: number | null; data_quality?: number } | null };
type Rel = { wallet_a: string; wallet_b: string; relation: string; status: string; confidence: number; frequency: number; first_seen: string | null; last_seen: string | null; reasons: string[]; evidence: { signature: string; at: string | null }[] };
type Bt = { id: string; created_at: string; horizon: string; test_from: string | null; test_to: string | null; test: M; baseline: M; warnings: string[] };
type M = { n: number; winRate: number | null; expectancy: number | null; profitFactor: number | null; maxDrawdownPct: number | null };

const DEC = ["ACCEPT", "WATCH", "REJECT", "INSUFFICIENT_DATA"] as const;
const DEC_CLS: Record<string, string> = { ACCEPT: "text-signal", WATCH: "text-warn", REJECT: "text-destructive", INSUFFICIENT_DATA: "text-muted-foreground" };
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—");
const n = (v: number | null | undefined, suf = "") => (v == null ? "—" : `${v}${suf}`);
const TABS = ["Ringkasan", "Detail wallet", "Backtest", "Job Monitor"] as const;

function WiePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Ringkasan");
  const [st, setSt] = useState<"loading" | "guest" | "error" | "ok">("loading");
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [bts, setBts] = useState<Bt[]>([]);
  const [wallets, setWallets] = useState<{ total: number | null; scored: number | null }>({ total: null, scored: null });
  const [rels, setRels] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return setSt("guest");
      const [s, b, w, sc, r] = await Promise.all([
        supabase.from("wallet_signals").select("id, wallet, mint, signal_at, delay_sec, liquidity_usd, entry_status, risk_score, gate_decision, gate").order("signal_at", { ascending: false }).limit(200),
        supabase.from("wie_backtests").select("id, created_at, horizon, test_from, test_to, test, baseline, warnings").order("created_at", { ascending: false }).limit(9),
        supabase.from("wallet_collect_state").select("wallet", { count: "exact", head: true }),
        supabase.from("wallet_score_history").select("wallet").gte("tokens_closed", 5).limit(1000),
        supabase.from("wallet_relations").select("id", { count: "exact", head: true }).neq("status", "rejected"),
      ]);
      if (s.error) return setSt("error");
      setSigs((s.data ?? []) as unknown as Sig[]);
      setBts((b.data ?? []) as unknown as Bt[]);
      setWallets({ total: w.count, scored: new Set((sc.data ?? []).map((x) => x.wallet)).size });
      setRels(r.count);
      setSt("ok");
    })();
  }, []);

  return (
    <div>
      <PageHeader title="Wallet Intelligence" subtitle="Hanya untuk simulasi/paper trading. Skor bukan perintah beli dan tidak menjamin profit." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={tab === t ? "btn !py-1" : "btn-ghost !py-1"}>{t}</button>)}
      </div>
      {tab === "Job Monitor" ? <WieStatus /> : st === "loading" ? <div className="card text-sm text-muted-foreground">Memuat…</div>
        : st === "guest" ? <div className="card text-sm text-muted-foreground">Masuk untuk melihat Wallet Intelligence.</div>
        : st === "error" ? <div className="card text-sm text-destructive">Data tidak dapat dimuat.</div>
        : tab === "Ringkasan" ? <Overview sigs={sigs} wallets={wallets} rels={rels} />
        : tab === "Backtest" ? <Backtests bts={bts} />
        : <WalletDetail />}
    </div>
  );
}

function Mini({ label, value, cls = "" }: { label: string; value: number | string; cls?: string }) {
  return <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 font-mono text-lg font-semibold ${cls}`}>{value}</div></div>;
}

function Overview({ sigs, wallets, rels }: { sigs: Sig[]; wallets: { total: number | null; scored: number | null }; rels: number | null }) {
  const count = (d: string) => sigs.filter((s) => s.gate_decision === d).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Wallet dipantau" value={n(wallets.total)} />
        <Mini label="Wallet sampel ≥5 trade" value={n(wallets.scored)} />
        <Mini label="Relasi berbukti" value={n(rels)} />
        <Mini label="Sinyal belum dinilai" value={sigs.filter((s) => !s.gate_decision).length} />
        {DEC.map((d) => <Mini key={d} label={d} value={count(d)} cls={DEC_CLS[d]} />)}
      </div>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Sinyal terbaru</h2>
        {!sigs.length ? <p className="text-sm text-muted-foreground">Belum ada sinyal. Sinyal muncul setelah collector mengumpulkan pembelian wallet (butuh key Helius aktif).</p> : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="pr-3">Waktu</th><th className="pr-3">Wallet</th><th className="pr-3">Token</th><th className="pr-3">Delay</th><th className="pr-3">Likuiditas</th><th className="pr-3">Entry</th><th className="pr-3">Risiko</th><th className="pr-3">Gate</th><th>Alasan</th></tr></thead>
            <tbody>{sigs.slice(0, 50).map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="pr-3 font-mono">{fmt(s.signal_at)}</td><td className="pr-3 font-mono">{short(s.wallet)}</td><td className="pr-3 font-mono">{short(s.mint)}</td>
                <td className="pr-3 font-mono">{s.delay_sec == null ? "—" : `${Math.round(s.delay_sec / 60)}m`}</td>
                <td className="pr-3 font-mono">{s.liquidity_usd == null ? "tidak diketahui" : `$${Math.round(Number(s.liquidity_usd)).toLocaleString()}`}</td>
                <td className="pr-3">{s.entry_status}</td><td className="pr-3 font-mono">{n(s.risk_score)}</td>
                <td className={`pr-3 font-semibold ${DEC_CLS[s.gate_decision ?? ""] ?? "text-muted-foreground"}`}>{s.gate_decision ?? "menunggu"}</td>
                <td className="max-w-[18rem] truncate text-muted-foreground" title={s.gate?.reasons?.join("; ")}>{s.gate?.reasons?.join("; ") ?? "—"}</td>
              </tr>))}</tbody>
          </table>)}
      </section>
    </div>
  );
}

function Backtests({ bts }: { bts: Bt[] }) {
  if (!bts.length) return <div className="card text-sm text-muted-foreground">Belum ada backtest. Backtest berjalan setiap 24 jam setelah ada sinyal yang dinilai gate.</div>;
  const latest = ["15m", "1h", "24h"].map((h) => bts.find((b) => b.horizon === h)).filter(Boolean) as Bt[];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {latest.map((b) => (
        <section key={b.id} className="card space-y-2 text-sm">
          <h2 className="font-semibold">Horizon {b.horizon}</h2>
          <p className="text-xs text-muted-foreground">Periode uji: {fmt(b.test_from)} – {fmt(b.test_to)} · dibuat {fmt(b.created_at)}</p>
          <table className="w-full text-xs"><thead className="text-muted-foreground"><tr><th className="text-left">Metrik</th><th>Gate ACCEPT</th><th>Baseline</th></tr></thead>
            <tbody>{([["Sampel", "n", ""], ["Win rate", "winRate", "%"], ["Net expectancy", "expectancy", "%"], ["Profit factor", "profitFactor", ""], ["Max drawdown", "maxDrawdownPct", "%"]] as const).map(([l, k, s]) => (
              <tr key={k} className="border-t border-border"><td>{l}</td><td className="text-center font-mono">{n(b.test[k], s)}</td><td className="text-center font-mono">{n(b.baseline[k], s)}</td></tr>))}</tbody></table>
          <ul className="list-disc pl-4 text-xs text-warn">{b.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>))}
      <p className="text-xs text-muted-foreground md:col-span-3">Hasil setelah biaya estimasi. Pembagian latih/uji kronologis 60/40; token tanpa harga lanjutan dihitung −100%, bukan dibuang.</p>
    </div>
  );
}

function WalletDetail() {
  const [addr, setAddr] = useState("");
  const [d, setD] = useState<null | "loading" | { scores: { scored_at: string; score: number; confidence: number; win_rate: number; tokens_closed: number; cls: string; score_version: string }[]; outcomes: { mint: string; roi: number | null; hold_sec: number | null; is_closed: boolean }[]; rels: Rel[]; events: number | null }>(null);
  const load = async () => {
    const a = addr.trim(); if (!a) return;
    setD("loading");
    const [s, o, ra, rb, e] = await Promise.all([
      supabase.from("wallet_score_history").select("scored_at, score, confidence, win_rate, tokens_closed, cls, score_version").eq("wallet", a).order("scored_at", { ascending: false }).limit(20),
      supabase.from("wallet_outcomes").select("mint, roi, hold_sec, is_closed").eq("wallet", a).order("computed_at", { ascending: false }).limit(50),
      supabase.from("wallet_relations").select("wallet_a, wallet_b, relation, status, confidence, frequency, first_seen, last_seen, reasons, evidence").eq("wallet_a", a).limit(120),
      supabase.from("wallet_relations").select("wallet_a, wallet_b, relation, status, confidence, frequency, first_seen, last_seen, reasons, evidence").eq("wallet_b", a).limit(120),
      supabase.from("wallet_events").select("id", { count: "exact", head: true }).eq("wallet", a),
    ]);
    setD({ scores: s.data ?? [], outcomes: (o.data ?? []).map((x) => ({ ...x, roi: x.roi == null ? null : Number(x.roi) })), rels: [...(ra.data ?? []), ...(rb.data ?? [])] as unknown as Rel[], events: e.count });
  };
  const a = addr.trim();
  return (
    <div className="space-y-4">
      <form className="card flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <label htmlFor="wie-addr" className="sr-only">Alamat wallet</label>
        <input id="wie-addr" className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 font-mono text-sm" placeholder="Alamat wallet" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <button className="btn">Lihat</button>
      </form>
      {d === "loading" && <div className="card text-sm text-muted-foreground">Memuat…</div>}
      {d && d !== "loading" && (<>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Event tersimpan" value={n(d.events)} />
          <Mini label="Skor terakhir" value={n(d.scores[0]?.score)} />
          <Mini label="Confidence" value={n(d.scores[0]?.confidence)} />
          <Mini label="Peran (dapat berubah)" value={d.scores[0]?.cls ?? "—"} />
        </div>
        {!d.scores.length && <p className="text-sm text-warn">Data belum cukup: wallet ini belum punya trade tertutup yang dinilai.</p>}
        <section className="card overflow-x-auto"><h2 className="mb-2 font-semibold">Histori skor</h2>
          {d.scores.length ? <table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th>Waktu</th><th>Skor</th><th>Confidence</th><th>Win rate</th><th>Trade</th><th>Versi</th></tr></thead>
            <tbody>{d.scores.map((s) => <tr key={s.scored_at} className="border-t border-border font-mono"><td>{fmt(s.scored_at)}</td><td>{s.score}</td><td>{s.confidence}</td><td>{s.win_rate}%</td><td>{s.tokens_closed}</td><td>{s.score_version}</td></tr>)}</tbody></table>
            : <p className="text-sm text-muted-foreground">Kosong.</p>}
        </section>
        <section className="card"><h2 className="mb-2 font-semibold">Hasil per token</h2>
          {d.outcomes.length ? <div className="flex flex-wrap items-end gap-1" aria-label="Grafik ROI per token">
            {d.outcomes.map((o) => <div key={o.mint} title={`${short(o.mint)} · ROI ${o.roi ?? "?"}× · ${o.is_closed ? "tertutup" : "terbuka"}`} className={o.roi == null || !o.is_closed ? "w-3 bg-muted" : o.roi >= 1 ? "w-3 bg-signal" : "w-3 bg-destructive"} style={{ height: `${Math.max(4, Math.min(80, (o.roi ?? 0.5) * 30))}px` }} />)}
          </div> : <p className="text-sm text-muted-foreground">Belum ada outcome.</p>}
        </section>
        <RelGraph center={a} rels={d.rels} />
      </>)}
    </div>
  );
}

function RelGraph({ center, rels }: { center: string; rels: Rel[] }) {
  const { nodes, edges } = neighbourhood(center, rels);
  const W = 600, H = 320, R = 120;
  const pos = new Map(nodes.map((id, i) => [id, i === 0 ? { x: W / 2, y: H / 2 } : { x: W / 2 + R * 1.8 * Math.cos((i / (nodes.length - 1)) * 2 * Math.PI), y: H / 2 + R * Math.sin((i / (nodes.length - 1)) * 2 * Math.PI) }]));
  const col = (s: string) => (s === "strong_evidence" ? "var(--signal)" : s === "suspected" ? "var(--warn)" : s === "rejected" ? "var(--destructive)" : "var(--muted-foreground)");
  return (
    <section className="card space-y-3"><h2 className="font-semibold">Relasi wallet (maks 60 node)</h2>
      {!edges.length ? <p className="text-sm text-muted-foreground">Belum ada relasi tercatat untuk wallet ini.</p> : (<>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-border">
          {edges.map((e, i) => { const p = pos.get(e.wallet_a)!, q = pos.get(e.wallet_b)!; return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={col(e.status)} strokeWidth={1 + e.confidence / 30} strokeDasharray={e.status === "observed" ? "4 4" : undefined} />; })}
          {nodes.map((id, i) => { const p = pos.get(id)!; return <g key={id} transform={`translate(${p.x},${p.y})`}><circle r={i ? 6 : 10} fill={i ? "var(--muted-foreground)" : "var(--primary)"} /><text y={18} textAnchor="middle" fontSize="9" fill="var(--foreground)" fontFamily="JetBrains Mono">{short(id)}</text></g>; })}
        </svg>
        <ul className="space-y-2 text-xs">{edges.map((e) => (
          <li key={`${e.wallet_a}${e.wallet_b}${e.relation}`} className="rounded border border-border p-2">
            <div className="font-mono">{short(e.wallet_a === center ? e.wallet_b : e.wallet_a)} · {e.relation === "funding" ? "transfer SOL" : "masuk bersamaan"} · <span style={{ color: col(e.status) }}>{e.status}</span> · confidence {e.confidence} · {e.frequency}×</div>
            <div className="text-muted-foreground">{e.reasons.join("; ")} · {fmt(e.first_seen)} – {fmt(e.last_seen)}</div>
            <div className="truncate font-mono text-muted-foreground">Bukti: {e.evidence.slice(-3).map((x) => short(x.signature)).join(", ")}</div>
          </li>))}</ul>
        <p className="text-xs text-muted-foreground">Relasi adalah pengamatan, bukan bukti kepemilikan yang sama.</p>
      </>)}
    </section>
  );
}
