import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyBtn } from "@/components/CopyBtn";
import { useMemo, useRef, useState } from "react";
import { PageHeader, Stat } from "@/components/ui-bits";
import { setState, useStore, isAutoTag, getState, blacklistLabel, type MemoryEntry } from "@/lib/store";
import { WalletTag, WALLET_TAG_LABELS } from "@/components/WalletTag";
import { trackRecord, hasKeys } from "@/lib/real";
import { walletScore } from "@/lib/edge";
import { classifyWallet, inspectWallet } from "@/lib/wallet-inspect";
import { WieStatus } from "@/components/WieStatus";

export const Route = createFileRoute("/memory")({
  head: () => ({ meta: [
    { title: "Cluster Memory — Solana Sentinel" },
    { name: "description", content: "Riwayat wallet dengan label Serial Rugger, Kandidat Cabal, dan Pola Bundler, belum dinilai." },
    { property: "og:title", content: "Cluster Memory — Solana Sentinel" },
    { property: "og:description", content: "Tagged wallet history for Solana clusters." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Memory,
});

const RISK = { watch: 0, cabal: 1, rugger: 2 } as const;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function download(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

function parseFile(text: string): MemoryEntry[] {
  const norm = (x: { address?: unknown; tag?: unknown; note?: unknown; seen?: unknown; at?: unknown }): MemoryEntry | null => {
    const address = String(x.address ?? "").trim();
    if (!B58.test(address)) return null;
    const t = String(x.tag ?? "watch").toLowerCase();
    const tag = (t in RISK ? t : "watch") as MemoryEntry["tag"];
    return { address, tag, note: String(x.note ?? ""), seen: Math.max(1, Number(x.seen) || 1), at: Number(x.at) || Date.parse(String(x.at)) || Date.now() };
  };
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : j.wallets ?? j.memory ?? [];
    return arr.map(norm).filter(Boolean) as MemoryEntry[];
  }
  const lines = t.split(/\r?\n/).filter(Boolean);
  const head = lines[0]!.toLowerCase().includes("address") ? lines.shift()!.split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase()) : null;
  return lines.map((l) => {
    const cells = (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
    if (!head) return norm({ address: cells[0], tag: cells[1] as MemoryEntry["tag"], note: cells[2] });
    const o: Record<string, string> = {}; head.forEach((h, i) => { o[h] = cells[i] ?? ""; });
    return norm(o as never);
  }).filter(Boolean) as MemoryEntry[];
}

function Memory() {
  const { memory, blacklist } = useStore((s) => s);
  const [addr, setAddr] = useState(""); const [tag, setTag] = useState<MemoryEntry["tag"]>("rugger"); const [note, setNote] = useState("");
  const [bl, setBl] = useState("");
  const [msg, setMsg] = useState("");
  const [rating, setRating] = useState("");
  /** Pisces 6: win-rate & PnL for up to 30 cabal wallets not rated in the last 24h (1 Helius call each). */
  const rate = async () => {
    const todo = getState().memory.filter((m) => m.tag === "cabal" && (!m.perf || Date.now() - m.perf.at > 86_400_000)).sort((a, b) => b.seen - a.seen).slice(0, 30);
    let i = 0;
    for (const m of todo) {
      setRating(`Menilai ${++i}/${todo.length}…`);
      const perf = await trackRecord(m.address).catch(() => null);
      if (perf) setState((s) => ({ memory: s.memory.map((x) => x.address === m.address ? { ...x, perf } : x) }));
    }
    setRating(""); setMsg(todo.length ? `Win-rate dihitung untuk ${todo.length} wallet.` : "Semua wallet cabal sudah dinilai dalam 24 jam terakhir.");
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<"all" | "manual" | "auto">("all"); const [ft, setFt] = useState<"all" | MemoryEntry["tag"]>("all"); const [qq, setQq] = useState("");
  const [sort, setSort] = useState<"at" | "seen" | "score">("at");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [insp, setInsp] = useState(""); const [busy, setBusy] = useState("");
  const [results, setResults] = useState<{ address: string; tag: MemoryEntry["tag"] | null; reason: string; saved: boolean }[]>([]);
  const stats = useMemo(() => ({ cabal: memory.filter((m) => m.tag === "cabal").length, watch: memory.filter((m) => m.tag === "watch").length, rugger: memory.filter((m) => m.tag === "rugger").length, alpha: memory.filter((m) => m.perf?.cls === "alpha").length }), [memory]);
  const shown = memory.filter((m) => (src === "all" || (src === "auto") === isAutoTag(m)) && (ft === "all" || m.tag === ft) && (!qq || m.address.toLowerCase().includes(qq.toLowerCase()) || m.note.toLowerCase().includes(qq.toLowerCase())))
    .sort((a, b) => sort === "seen" ? b.seen - a.seen : sort === "score" ? walletScore(b) - walletScore(a) : b.at - a.at);
  const PER = 50; const pages = Math.max(1, Math.ceil(shown.length / PER));
  const pageRows = shown.slice(Math.min(page, pages - 1) * PER, Math.min(page, pages - 1) * PER + PER);
  const toggle = (a: string) => setSel((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  const batchTag = (t: MemoryEntry["tag"]) => { setState((s) => ({ memory: s.memory.map((m) => sel.has(m.address) ? { ...m, tag: t, note: isAutoTag(m) ? m.note.replace(/^Auto:\s*/, "Manual: ") : m.note } : m) })); setMsg(`${sel.size} wallet diubah ke ${WALLET_TAG_LABELS[t]}.`); setSel(new Set()); };
  const runInspect = async () => {
    const addrs = [...new Set(insp.split(/[\s,]+/).map((x) => x.trim()).filter((x) => B58.test(x)))].slice(0, 20);
    if (!addrs.length) return setMsg("Masukkan minimal 1 alamat Solana valid.");
    if (!hasKeys()) return setMsg("Tambahkan minimal 1 Helius API key aktif di halaman Keys.");
    const out: typeof results = [];
    for (let i = 0; i < addrs.length; i++) {
      const a = addrs[i]!; setBusy(`Menginspeksi ${i + 1}/${addrs.length}…`);
      try {
        const ev = await inspectWallet(a, blacklistLabel);
        const r = classifyWallet(ev);
        const ex = getState().memory.find((m) => m.address === a);
        const canWrite = !!r.tag && (!ex || isAutoTag(ex));
        if (canWrite) setState((s) => ({ memory: [{ address: a, tag: r.tag!, note: r.note, seen: (ex?.seen ?? 0) + 1, at: Date.now(), perf: ev.perf ?? ex?.perf ?? null }, ...s.memory.filter((m) => m.address !== a)] }));
        out.push({ address: a, tag: r.tag, reason: r.reason, saved: canWrite });
      } catch (e) { out.push({ address: a, tag: null, reason: `Gagal: ${(e as Error).message}`, saved: false }); }
      setResults([...out]);
    }
    setBusy(""); setInsp("");
  };
  const add = () => { if (!B58.test(addr.trim())) return setMsg("Alamat Solana tidak valid."); setState((s) => ({ memory: [{ address: addr.trim(), tag, note, seen: 1, at: Date.now() }, ...s.memory.filter((m) => m.address !== addr.trim())] })); setAddr(""); setNote(""); };

  const stamp = new Date().toISOString().slice(0, 10);
  const exportJson = () => download(`solana-cluster-memory-${stamp}.json`, JSON.stringify({ format: "solana-sentinel-memory", version: 1, exportedAt: new Date().toISOString(), wallets: memory.map((m) => ({ ...m, source: isAutoTag(m) ? "auto" : "manual" })) }, null, 2), "application/json");
  const exportCsv = () => download(`solana-cluster-memory-${stamp}.csv`, ["address,tag,note,seen,at,source", ...memory.map((m) => [m.address, m.tag, m.note, m.seen, new Date(m.at).toISOString(), isAutoTag(m) ? "auto" : "manual"].map(csvCell).join(","))].join("\n"), "text/csv");
  const importFile = async (f: File) => {
    try {
      const rows = parseFile(await f.text());
      if (!rows.length) return setMsg("Tidak ada alamat valid di file.");
      const cur = new Map(getState().memory.map((m) => [m.address, m]));
      let added = 0, updated = 0;
      for (const r of rows) {
        const ex = cur.get(r.address);
        if (!ex) { cur.set(r.address, r); added++; continue; }
        updated++;
        cur.set(r.address, { ...ex, tag: RISK[r.tag] > RISK[ex.tag] ? r.tag : ex.tag, note: r.note || ex.note, seen: Math.max(ex.seen, r.seen), at: Date.now() });
      }
      setState(() => ({ memory: [...cur.values()].sort((a, b) => b.at - a.at) }));
      setMsg(`Impor selesai: ${added} baru, ${updated} diperbarui (${rows.length} valid).`);
    } catch { setMsg("File tidak bisa dibaca. Gunakan JSON/CSV hasil ekspor."); }
  };

  return (
    <>
      <PageHeader title="Cluster Memory Database" sub="Tersimpan permanen di akun — tidak terhapus oleh reset aplikasi."
        right={<div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={!memory.length} onClick={exportJson}>Export JSON</button>
          <button className="btn-ghost" disabled={!memory.length} onClick={exportCsv}>Export CSV</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import file</button>
          <input ref={fileRef} type="file" accept=".json,.csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
        </div>} />
      {msg && <div className="card mb-4 font-mono text-sm">{msg}</div>}
      <WieStatus />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total wallet" value={memory.length} />
        <Stat label={WALLET_TAG_LABELS.cabal} value={stats.cabal} tone="signal" />
        <Stat label={WALLET_TAG_LABELS.watch} value={stats.watch} tone="warn" />
        <Stat label={WALLET_TAG_LABELS.rugger} value={stats.rugger} tone="risk" />
        <Stat label="Alpha Whale" value={stats.alpha} tone="cyan" />
      </div>
      <div className="card mb-4">
        <div className="label mb-2">Inspeksi wallet mandiri & auto-pengelompokan</div>
        <p className="mb-2 text-xs text-muted-foreground">Tempel 1 atau beberapa alamat (per baris, maks 20). Aplikasi melacak sub-wallet, pola bundle dan win-rate, lalu menyimpan otomatis ke grup yang sesuai. Tag manual tidak ditimpa. ±2 panggilan Helius per wallet.</p>
        <textarea className="inp mb-2 h-20 w-full font-mono text-xs" placeholder="Alamat wallet Solana…" value={insp} onChange={(e) => setInsp(e.target.value)} />
        <button className="btn" disabled={!!busy} onClick={runInspect}>{busy || "🔍 Inspeksi & kelompokkan"}</button>
        {results.length > 0 && <div className="mt-3 space-y-1 font-mono text-xs">{results.map((r) => (
          <div key={r.address} className="flex flex-wrap gap-2"><span>{r.address.slice(0, 6)}…{r.address.slice(-4)}</span>
            <span className={r.tag ? "text-signal" : "text-muted-foreground"}>{r.tag ? `${WALLET_TAG_LABELS[r.tag]}${r.saved ? " · tersimpan" : " · tag manual dipertahankan"}` : "Tidak disimpan"}</span>
            <span className="text-muted-foreground">{r.reason}</span></div>))}</div>}
      </div>
      <div className="card mb-4 flex flex-wrap gap-3">
        <input className="inp flex-1" placeholder="Wallet address" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <select className="inp w-full sm:w-auto" value={tag} onChange={(e) => setTag(e.target.value as MemoryEntry["tag"])}>
          {Object.entries(WALLET_TAG_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input className="inp w-56" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" onClick={add}>Save</button>
      </div>
      <div className="card mb-4 flex flex-wrap items-center gap-2">
        <input className="inp flex-1" placeholder="Cari alamat / catatan…" value={qq} onChange={(e) => setQq(e.target.value)} />
        <select className="inp w-auto" value={src} onChange={(e) => setSrc(e.target.value as "all")}><option value="all">Semua sumber</option><option value="manual">Manual</option><option value="auto">Otomatis</option></select>
        <select className="inp w-full sm:w-auto" value={ft} onChange={(e) => setFt(e.target.value as "all")}><option value="all">Semua tag</option>{Object.entries(WALLET_TAG_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <span className="text-xs text-muted-foreground">{shown.length}/{memory.length}</span>
        <button className="btn-ghost text-xs" disabled={!!rating} onClick={rate}>{rating || "📈 Hitung win-rate cabal (30)"}</button>
      </div>
      {sel.size > 0 && <div className="card mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">{sel.size} dipilih</span>
        {(Object.keys(WALLET_TAG_LABELS) as MemoryEntry["tag"][]).map((t) => <button key={t} className="btn-ghost text-xs" onClick={() => batchTag(t)}>→ {WALLET_TAG_LABELS[t]}</button>)}
        <button className="btn-ghost text-xs" onClick={() => setSel(new Set())}>Batal</button>
      </div>}
      <div className="card overflow-x-auto">
        {shown.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No tagged wallets yet. Click nodes in the trace graph or add one above.</p> : (<>
          <table className="w-full text-sm">
            <thead className="label"><tr>
              <th className="py-2 text-left"><input type="checkbox" checked={pageRows.every((m) => sel.has(m.address))} onChange={(e) => setSel((s) => { const n = new Set(s); pageRows.forEach((m) => e.target.checked ? n.add(m.address) : n.delete(m.address)); return n; })} /></th>
              <th className="text-left">Address</th><th className="text-left">Tag</th><th className="text-left">Note</th>
              <th className="cursor-pointer text-left" onClick={() => setSort("seen")}>Seen{sort === "seen" ? " ↓" : ""}</th>
              <th className="cursor-pointer text-left" onClick={() => setSort("score")}>Skor{sort === "score" ? " ↓" : ""}</th>
              <th className="cursor-pointer text-left" onClick={() => setSort("at")}>Added{sort === "at" ? " ↓" : ""}</th></tr></thead>
            <tbody>{pageRows.map((m) => (
              <tr key={m.address} className="border-t">
                <td className="py-2"><input type="checkbox" checked={sel.has(m.address)} onChange={() => toggle(m.address)} /></td>
                <td className="font-mono text-xs"><div className="flex flex-wrap items-center gap-1.5"><span className="break-all">{m.address}</span><CopyBtn text={m.address} />
                  <Link to="/wie" search={{ tab: "detail", wallet: m.address }} className="chip text-primary">WIE</Link>
                  <Link to="/scanner" search={{ addr: m.address, kind: "wallet" }} className="chip text-cyan">Trace</Link></div></td>
                <td><WalletTag entry={m} /></td><td className="text-muted-foreground">{m.note}</td>
                <td className="font-mono text-xs">{m.seen}</td>
                <td className="font-mono text-xs">{walletScore(m)}</td>
                <td className="font-mono text-xs text-muted-foreground">{new Date(m.at).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="mt-3 flex items-center justify-end gap-2 text-xs">
            <button className="btn-ghost text-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
            <span className="font-mono">{page + 1}/{pages}</span>
            <button className="btn-ghost text-xs" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
          </div>
        </>)}
      </div>
      <div className="card mt-4">
        <div className="label mb-3">CEX / Disperse blacklist ({blacklist.length})</div>
        <div className="mb-3 flex gap-2">
          <input className="inp" placeholder="address|label" value={bl} onChange={(e) => setBl(e.target.value)} />
          <button className="btn-ghost" onClick={() => { if (bl.includes("|")) { setState((s) => ({ blacklist: [...s.blacklist, bl.trim()] })); setBl(""); } }}>Add</button>
        </div>
        <div className="flex flex-wrap gap-2">{blacklist.map((b) => (
          <span key={b} className="chip text-muted-foreground">{b.split("|")[1]} · {b.slice(0, 6)}…
            <button onClick={() => setState((s) => ({ blacklist: s.blacklist.filter((x) => x !== b) }))}>×</button></span>
        ))}</div>
      </div>
    </>
  );
}
