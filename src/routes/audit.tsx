import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, PageHeader } from "@/components/ui-bits";
import { fmtUsd, short } from "@/lib/sim";
import { fetchMarket, holderConcentration, preflight } from "@/lib/real";
import { pushAlert, useStore } from "@/lib/store";

export const Route = createFileRoute("/audit")({
  head: () => ({ meta: [
    { title: "Safety Audit — Solana Sentinel" },
    { name: "description", content: "Token authority checks, liquidity filter, price impact and honeypot simulation." },
    { property: "og:title", content: "Safety Audit — Solana Sentinel" },
    { property: "og:description", content: "Pre-flight token safety guardrails for Solana." },
  ] }),
  component: Audit,
});

interface Result { mint: string; mintAuth: string | null | undefined; freezeAuth: string | null | undefined; lp: number | null; impact: number | null; tax: number | null; sellOk: boolean; roundTrip: number | null; cluster: number | null }

function Audit() {
  const g = useStore((s) => s.guard);
  const [mint, setMint] = useState("");
  const [size, setSize] = useState(1);
  const [r, setR] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const v = mint.trim(); if (v.length < 32) return;
    setBusy(true);
    try {
      const [m, pf, conc] = await Promise.all([fetchMarket(v), preflight(v, size), holderConcentration(v)]);
      const res: Result = {
        mint: v, mintAuth: m?.mintAuthority, freezeAuth: m?.freezeAuthority, lp: m?.liquidityUsd ?? null,
        impact: pf.buyImpact, tax: m?.sellTax ?? null, sellOk: pf.sellOk, roundTrip: pf.roundTripLossPct, cluster: conc,
      };
      setR(res);
      const fails = verdict(res).filter((x) => x.ok === false).length;
      if (fails) pushAlert("risk", `Audit ${short(v)}: ${fails} guardrail(s) failed`);
    } finally { setBusy(false); }
  };

  const nv = "tidak terverifikasi (butuh Helius key)";
  const verdict = (x: Result) => [
    { ok: x.mintAuth === undefined ? null : x.mintAuth === null, label: "Mint authority revoked", detail: x.mintAuth === undefined ? nv : x.mintAuth ?? "null" },
    { ok: x.freezeAuth === undefined ? null : x.freezeAuth === null, label: "Freeze authority revoked", detail: x.freezeAuth === undefined ? nv : x.freezeAuth ?? "null" },
    { ok: x.lp === null ? null : x.lp >= g.minLp, label: `Liquidity ≥ ${fmtUsd(g.minLp)}`, detail: x.lp === null ? "pair tidak ditemukan" : fmtUsd(x.lp) },
    { ok: x.impact === null ? null : x.impact <= g.maxImpact, label: `Price impact ≤ ${g.maxImpact}% (${size} SOL, Jupiter)`, detail: x.impact === null ? "tidak ada rute" : `${x.impact.toFixed(2)}%` },
    { ok: x.sellOk && (x.tax ?? 0) < 10, label: "Pre-flight sell quote", detail: !x.sellOk ? "rute jual gagal — kemungkinan honeypot" : `round-trip loss ${x.roundTrip}%${x.tax !== null ? ` · transfer fee ${x.tax}%` : ""}` },
    { ok: x.cluster === null ? null : x.cluster <= g.clusterCap, label: `Top-10 holder ≤ ${g.clusterCap}%`, detail: x.cluster === null ? nv : `${x.cluster}%` },
  ];

  const checks = r ? verdict(r) : [];
  const passed = checks.filter((c) => c.ok === true).length;
  const unknown = checks.filter((c) => c.ok === null).length;
  return (
    <>
      <PageHeader title="Safety Guardrails & Contract Audit" sub="Authorities, liquidity depth, price impact, honeypot simulation and cluster concentration." />
      <div className="card mb-6 flex flex-wrap gap-3">
        <input className="inp flex-1" placeholder="Token mint address" value={mint} onChange={(e) => setMint(e.target.value)} />
        <input className="inp w-28" type="number" step="0.1" value={size} onChange={(e) => setSize(+e.target.value)} title="Buy size (SOL)" />
        <button className="btn" disabled={busy} onClick={run}>{busy ? "Auditing…" : "Run audit"}</button>
      </div>
      {r && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card flex flex-col items-center justify-center text-center">
            <div className="label">Verdict</div>
            <div className={`mt-3 text-5xl font-bold ${passed === 6 ? "text-signal" : passed >= 4 ? "text-warn" : "text-destructive"}`}>{passed}/6</div>
            <div className="mt-2 text-sm">{passed === 6 ? "SAFE TO ENTER" : passed >= 4 ? "CAUTION" : "DO NOT ENTER"}</div>
            <div className="mt-3 chip text-muted-foreground">{unknown ? `${unknown} cek belum terverifikasi` : "semua cek dari data real"}</div>
          </div>
          <div className="card space-y-2 lg:col-span-2">{checks.map((c) => <Check key={c.label} label={c.label} detail={c.detail} ok={c.ok === true} />)}</div>
        </div>
      )}
    </>
  );
}
