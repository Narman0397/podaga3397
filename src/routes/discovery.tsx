import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui-bits";
import { CopyBtn } from "@/components/CopyBtn";
import { short } from "@/lib/sim";
import { discoverTokens, enrollDiscovered, type DiscoveredWallet } from "@/lib/discovery.functions";
import { isSolAddress } from "./wie";

export const Route = createFileRoute("/discovery")({
  head: () => ({ meta: [
    { title: "Wallet Discovery — Solana Sentinel" },
    { name: "description", content: "Bedah token dan panen wallet pemegang awal untuk dipantau Wallet Intelligence." },
    { property: "og:title", content: "Wallet Discovery — Solana Sentinel" },
    { property: "og:description", content: "Harvest early-holder wallets from tokens into WIE tracking." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DiscoveryPage,
});

function DiscoveryPage() {
  const [input, setInput] = useState("");
  const [st, setSt] = useState<"idle" | "loading" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);

  const run = async () => {
    setErr(null); setSaved(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setErr("Masuk dulu untuk memakai Discovery."); return; }
    const mints = [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
    if (!mints.length || mints.length > 5) { setErr("Tempel 1–5 contract address token."); return; }
    const bad = mints.find((m) => !isSolAddress(m));
    if (bad) { setErr(`Alamat tidak valid: ${short(bad)}`); return; }
    setSt("loading");
    const r = await discoverTokens({ data: { mints } });
    setSt("done");
    if (r.error && !r.wallets.length) { setErr(r.error); setWallets([]); return; }
    setWallets(r.wallets);
    setPicked(new Set(r.wallets.filter((w) => !w.alreadyTracked).map((w) => w.address)));
  };

  const enroll = async (list: DiscoveredWallet[]) => {
    if (!list.length) return;
    const r = await enrollDiscovered({ data: { wallets: list.map((w) => ({ address: w.address, viaMint: w.viaMint })) } });
    setSaved(`${r.tagged} wallet ditandai "watch", ${r.enrolled} wallet baru masuk antrean collector WIE.`);
    setWallets((ws) => ws.map((w) => list.some((x) => x.address === w.address) ? { ...w, alreadyTracked: true } : w));
  };

  const toggle = (a: string) => setPicked((p) => { const n = new Set(p); n.has(a) ? n.delete(a) : n.add(a); return n; });

  return (
    <div className="space-y-4">
      <PageHeader title="Wallet Discovery" sub="Perkaya daftar wallet yang dipantau WIE. Worker otomatis memanen dari token top-volume tiap 6 jam; di sini Anda bisa membedah token secara manual." />
      <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label htmlFor="disc-mints" className="text-xs text-muted-foreground">Contract address token (maks 5, pisahkan dengan spasi/koma/baris baru)</label>
        <textarea id="disc-mints" className="w-full rounded-lg border bg-surface px-3 py-2 font-mono text-sm" rows={3}
          placeholder="Tempel CA token yang sedang bergerak…" value={input} onChange={(e) => setInput(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={st === "loading"}>{st === "loading" ? "Membedah…" : "Bedah Token"}</button>
          {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
          {saved && <p role="status" className="text-xs text-signal">{saved}</p>}
        </div>
      </form>

      {st === "done" && wallets.length > 0 && (
        <section className="card overflow-x-auto space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{wallets.length} wallet ditemukan</h2>
            <button className="btn !py-1" onClick={() => void enroll(wallets.filter((w) => picked.has(w.address)))}>
              Pantau {picked.size} wallet terpilih
            </button>
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="pr-3"></th><th className="pr-3">Wallet</th><th className="pr-3">Via token</th><th className="pr-3">Track record</th><th className="pr-3">Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.address} className="border-t border-border">
                  <td className="pr-3"><input type="checkbox" aria-label={`Pilih ${short(w.address)}`} checked={picked.has(w.address)} onChange={() => toggle(w.address)} /></td>
                  <td className="pr-3 font-mono">
                    <Link to="/wie" search={{ tab: "detail", wallet: w.address }} className="text-primary hover:underline">{short(w.address)}</Link>
                    <CopyBtn text={w.address} />
                  </td>
                  <td className="pr-3 font-mono"><Link to="/scanner" search={{ addr: w.viaMint, kind: "token" }} className="text-primary hover:underline">{short(w.viaMint)}</Link></td>
                  <td className="pr-3 font-mono">{w.perf ? `WR ${w.perf.winRate}% · ROI ${w.perf.avgRoi}× · ${w.perf.tokens} token · ${w.perf.cls}` : "belum dinilai"}</td>
                  <td className="pr-3">{w.alreadyTracked ? <span className="text-signal">sudah dipantau</span> : <span className="text-muted-foreground">baru</span>}</td>
                  <td>{!w.alreadyTracked && <button className="btn-ghost !py-0.5" onClick={() => void enroll([w])}>Pantau</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">Wallet yang dipantau akan ditarik riwayat lengkapnya oleh collector WIE (tiap 30 menit), lalu dinilai win-rate/ROI secara otomatis.</p>
        </section>
      )}
    </div>
  );
}
