import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/ui-bits";
import { setState, useStore, DEFAULT_HELIUS, clampSlots, type HeliusToggle } from "@/lib/store";
import { ScanIntervalSelect } from "@/components/ScanInterval";
import { heliusRpc, pingKey, refreshKeyHealth } from "@/lib/helius";
import { allowKeyClear, getServerSyncStatus, getSyncStatus, saveNow, subscribeSync } from "@/lib/cloud-sync";

export const Route = createFileRoute("/keys")({
  head: () => ({ meta: [
    { title: "Helius Key Pool — Solana Sentinel" },
    { name: "description", content: "Manage a 20-slot Helius API key pool with auto-rotation, cloud sync and 429 fallback." },
    { property: "og:title", content: "Helius Key Pool — Solana Sentinel" },
    { property: "og:description", content: "20-slot Helius key rotation with health, cooldown and multi-device sync." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Keys,
});

const TONE = { active: "text-signal border-signal/40", cooldown: "text-warn border-warn/40", depleted: "text-destructive border-destructive/50", empty: "text-muted-foreground" };
const MODS: [HeliusToggle, string, string][] = [
  ["master", "MASTER · semua RPC Helius", "OFF = 0 panggilan Helius di browser"],
  ["radarVerify", "Radar auto-verification", "Authority, holders, flow 8 token/siklus"],
  ["radarAutoTrace", "Radar auto deep-trace Tier A/B", "Trace & auto-save cluster saat Radar terbuka"],
  ["scannerTrace", "Scanner cluster trace", "Reverse/forward trace saat scan"],
  ["scannerDeep", "Scanner deep audit 300 tx", "Early buyers, coordinated, dev dump"],
  ["signals", "Signals sub-wallet tracker", "Polling transaksi tiap 20 detik"],
  ["worker", "Cloud background worker", "Scan otomatis walau browser tertutup"],
  ["dailyTopVolume", "Scan harian Top Volume DexScreener", "Worker: 30 token volume 24 jam tertinggi → Radar, klasifikasi otomatis"],
  ["alphaHunter", "Pemburu Alpha Whale (6 jam)", "Worker: holder token Radar dengan WR >60% → Memory (maks 60 penilaian)"],
  ["stream", "Live stream wallet cabal", "WebSocket real-time ke ≤60 Kandidat Cabal (saat app terbuka)"],
  ["priceStream", "Live harga posisi (WebSocket)", "Pool tiap posisi terbuka dipantau langsung; trailing stop bereaksi seketika"],
];
function TraceSlots() {
  const hs = useStore((s) => s.helius);
  const g = clampSlots(hs?.traceSlotsGeneral, 2), p = clampSlots(hs?.traceSlotsPumpFun, 1);
  const set = (k: "traceSlotsGeneral" | "traceSlotsPumpFun", v: number) => { setState((s) => ({ helius: { ...DEFAULT_HELIUS, ...s.helius, [k]: clampSlots(v, 0) } })); saveNow(); };
  const row = (k: "traceSlotsGeneral" | "traceSlotsPumpFun", label: string, v: number) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <button className="btn-ghost !px-2 !py-0.5 text-xs" disabled={v <= 0} onClick={() => set(k, v - 1)}>−</button>
        <span className="w-4 text-center font-mono text-sm">{v}</span>
        <button className="btn-ghost !px-2 !py-0.5 text-xs" disabled={v >= 5} onClick={() => set(k, v + 1)}>+</button>
        <span className="text-xs text-muted-foreground">token/siklus</span>
      </span>
    </div>
  );
  const tot = g + p;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border px-3 py-2">
      <div className="label">Slot Dual Auto-Trace</div>
      {row("traceSlotsGeneral", "Slot DEX/Raydium (A/B/P/Q)", g)}
      {row("traceSlotsPumpFun", "Slot Pre-Raydium Pump.fun", p)}
      <p className="text-xs text-muted-foreground">Total: {tot} token / siklus (~{tot * 8}–{tot * 12} panggilan Helius per interval). 0 = jalur dimatikan.</p>
    </div>
  );
}
function ExitStrategy() {
  const g = useStore((s) => s.guard);
  const set = (k: "breakeven" | "dumpSignal", v: boolean) => { setState((s) => ({ guard: { ...s.guard, [k]: v } })); saveNow(); };
  const rows: ["breakeven" | "dumpSignal", string, string][] = [
    ["breakeven", "Breakeven stop", "Naik +20% → stop pindah ke harga masuk (termasuk fee). Trailing 25% dari puncak baru aktif setelah +50%."],
    ["dumpSignal", "Sinyal dump cluster", "Tutup posisi jika deployer atau ≥2 wallet bertag cabal menjual dalam 10 menit (pakai kuota Helius)."],
  ];
  return (
    <div className="card mb-4">
      <div className="label">Strategi exit paper trading (eksperimen)</div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {rows.map(([k, l, d]) => (
          <label key={k} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div><div className="text-sm font-medium">{l}</div><div className="text-xs text-muted-foreground">{d}</div></div>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!g?.[k]} onChange={(e) => set(k, e.target.checked)} />
          </label>
        ))}
      </div>
      <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
        <div><div className="text-sm font-medium">Gerbang skor edge (auto-buy paper)</div><div className="text-xs text-muted-foreground">Auto-buy hanya jika skor token ≥ batas. Skor: cabal, early buyer bertag, inflow terkoordinasi, dikurangi exit & konsentrasi.</div></div>
        <input type="number" className="inp w-20" min={0} max={100} value={g?.minScore ?? 60} onChange={(e) => { setState((s) => ({ guard: { ...s.guard, minScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })); saveNow(); }} />
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!g?.scoreGate} onChange={(e) => { setState((s) => ({ guard: { ...s.guard, scoreGate: e.target.checked } })); saveNow(); }} />
      </label>
      <label className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
        <div><div className="text-sm font-medium">Exit mirroring (wallet pemicu)</div><div className="text-xs text-muted-foreground">Jika wallet cabal yang memicu entry menjual ≥25%: ketatkan trailing jadi −10% dari puncak, atau jual 50%.</div></div>
        <select className="inp w-auto" value={g?.mirror ?? "off"} onChange={(e) => { setState((s) => ({ guard: { ...s.guard, mirror: e.target.value as "off" } })); saveNow(); }}>
          <option value="off">Mati</option><option value="tighten">Ketatkan trailing</option><option value="half">Jual 50%</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">OFF = aturan lama (trailing 25% aktif setelah +15%, stop awal −40%). Berlaku di browser dan worker 24/7; alasan exit tercatat di riwayat trade.</p>
    </div>
  );
}
function HeliusToggles() {
  const h = { ...DEFAULT_HELIUS, ...useStore((s) => s.helius) };
  const set = (k: HeliusToggle, v: boolean) => { setState((s) => ({ helius: { ...DEFAULT_HELIUS, ...s.helius, [k]: v } })); saveNow(); };
  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between"><div className="label">Kontrol kuota Helius per fitur</div>
        <button className="btn-ghost !py-1 text-xs" onClick={() => set("master", !h.master)}>{h.master ? "Pause semua" : "Aktifkan semua"}</button></div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {MODS.map(([k, l, d]) => {
          const on = h[k] && (k === "master" || h.master);
          return (
            <label key={k} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div><div className="text-sm font-medium">{l}</div><div className="text-xs text-muted-foreground">{on ? d : "OFF · 0 panggilan"}</div></div>
              <input type="checkbox" className="h-5 w-5 accent-primary" checked={h[k]} onChange={(e) => set(k, e.target.checked)} />
            </label>
          );
        })}
      </div>
      <TraceSlots />
      <div className="mt-3 rounded-lg border border-border px-3 py-2"><ScanIntervalSelect /></div>
      <p className="mt-2 text-xs text-muted-foreground">Tombol "Verify Now", Test pool dan Cek key tetap manual. Pengaturan tersimpan ke akun (worker cloud ikut membaca).</p>
    </div>
  );
}

const SYNC_LABEL = { guest: "Tamu · hanya di perangkat ini", loading: "Memuat dari cloud…", synced: "Tersinkron", saving: "Menyimpan…", error: "Gagal sinkron" };

function Keys() {
  const { keys, rotation, cursor, webhookUrl } = useStore((s) => s);
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus, getServerSyncStatus);
  const [now, setNow] = useState(0);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<string[]>(keys.map((k) => k.key));
  const [dirty, setDirty] = useState(false);
  const [bulk, setBulk] = useState("");
  const [ping, setPing] = useState<Record<number, string>>({});
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => { setNow(Date.now()); refreshKeyHealth(); }, 1000); return () => clearInterval(t); }, []);
  // Reflect cloud state arriving after render unless the user is editing.
  const joined = keys.map((k) => k.key).join("|");
  useEffect(() => { if (!dirty) setDraft(keys.map((k) => k.key)); }, [joined, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (vals = draft) => {
    const clean = vals.map((v) => v.trim());
    if (!clean.some(Boolean) && keys.some((k) => k.key)) allowKeyClear();
    setState((s) => ({ keys: s.keys.map((k, j) => clean[j] === k.key ? k : { ...k, key: clean[j] ?? "", status: clean[j] ? "active" : "empty", reason: undefined, fails: 0, cooldownUntil: 0 }) }));
    setDirty(false); saveNow();
    setMsg(sync.status === "guest" ? "Tersimpan di perangkat ini. Masuk untuk menyimpan ke akun." : "Tersimpan ke akun Anda.");
  };
  const applyBulk = () => {
    const found = [...new Set(bulk.split(/[\s,;|"'`]+/).map((x) => x.replace(/.*api-key=/, "").trim()).filter((x) => /^[0-9a-f-]{30,}$/i.test(x)))];
    const next = [...draft]; let i = 0;
    for (const k of found) { if (next.includes(k)) continue; while (i < 20 && next[i]) i++; if (i >= 20) break; next[i] = k; }
    setDraft(next); setBulk(""); save(next);
    setMsg(`${found.length} key terdeteksi dan disimpan.`);
  };
  const pingAll = async () => {
    const out: Record<number, string> = {};
    await Promise.all(draft.map(async (k, i) => { if (k.trim()) out[i] = await pingKey(k.trim()); }));
    setPing(out);
    setState((s) => ({ keys: s.keys.map((k, i) => {
      const r = out[i]; if (!r || draft[i]?.trim() !== k.key) return k;
      if (r === "quota") return { ...k, status: "depleted", reason: "quota" };
      if (r === "invalid") return { ...k, status: "depleted", reason: "invalid" };
      if (r === "ok" && k.status === "depleted") return { ...k, status: "active", reason: undefined };
      return k;
    }) }));
  };
  const test = async () => { setMsg("Pinging…"); const r = await heliusRpc<number>("getSlot", []); setMsg(r ? `OK — current slot ${r}` : "No usable key responded."); };

  return (
    <>
      <PageHeader title="Helius Multi-Key Pool" sub="20 slots · auto-rotation · antrean anti rate-limit · cooldown 60 detik saat 429."
        right={<div className="flex flex-wrap gap-2">
          <select className="inp w-auto" value={rotation} onChange={(e) => setState(() => ({ rotation: e.target.value as "round-robin" }))}>
            <option value="round-robin">Round-robin</option><option value="fallback">Priority fallback</option>
          </select>
          <button className="btn-ghost" onClick={pingAll}>Cek semua key</button>
          <button className="btn" onClick={test}>Test pool</button>
        </div>} />
      <div className={`card mb-4 flex flex-wrap items-center justify-between gap-2 text-sm ${sync.status === "error" ? "border-destructive/60" : sync.status === "guest" ? "border-warn/40" : ""}`}>
        <span>☁ {SYNC_LABEL[sync.status]}{sync.email ? ` · ${sync.email}` : ""}</span>
        {sync.status === "guest" && <Link to="/auth" className="btn-ghost !py-1 text-xs">Masuk agar key tersimpan di semua perangkat</Link>}
        <button className="btn !py-1 text-xs" disabled={!dirty || sync.status === "loading"} onClick={() => save()}>{dirty ? "Simpan perubahan" : "Tersimpan"}</button>
      </div>
      <HeliusToggles />
      <ExitStrategy />
      {msg && <div className="card mb-4 font-mono text-sm">{msg}</div>}
      <div className="card mb-4">
        <div className="label">Tempel banyak key sekaligus</div>
        <textarea className="inp mt-2 h-20 font-mono text-xs" placeholder="Pisahkan dengan baris baru, koma, atau tempel URL RPC berisi api-key=…" value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <button className="btn mt-2 !py-1 text-xs" disabled={!bulk.trim()} onClick={applyBulk}>Isi slot kosong & simpan</button>
      </div>
      {keys.some((k) => k.status === "depleted") && (
        <div className="card mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>{keys.filter((k) => k.status === "depleted" && k.reason === "quota").length} habis kuota bulanan · {keys.filter((k) => k.status === "depleted" && k.reason !== "quota").length} tidak valid</span>
          <button className="btn-ghost !py-1 text-xs text-destructive" onClick={() => { setDraft(draft.map((d, j) => keys[j]?.status === "depleted" ? "" : d)); setDirty(true); }}>Kosongkan semua key mati</button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {keys.map((k, i) => {
          const left = Math.max(0, Math.ceil((k.cooldownUntil - now) / 1000));
          const p = ping[i];
          return (
            <div key={i} className={`card flex items-center gap-3 !p-3 ${i === cursor && k.status === "active" ? "ring-1 ring-primary" : ""}`}>
              <span className="w-6 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <input type="password" className="inp" placeholder="Helius API key" value={draft[i] ?? ""} onChange={(e) => { const n = [...draft]; n[i] = e.target.value; setDraft(n); setDirty(true); }} />
              <span className={`chip w-28 justify-center ${TONE[k.status]}`}>{k.status === "cooldown" ? `Cooldown ${left}s` : k.status === "depleted" ? (k.reason === "quota" ? "Habis kuota" : "Tidak valid") : k.status === "active" ? "Aktif" : "Kosong"}</span>
              {p && <span className={`chip ${p === "ok" ? "text-signal border-signal/40" : "text-destructive border-destructive/50"}`}>{p}</span>}
              <span className="w-16 text-right font-mono text-[11px] text-muted-foreground">{k.calls}✓ {k.fails}✗</span>
              {k.status === "depleted" && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setState((s) => ({ keys: s.keys.map((x, j) => j === i ? { ...x, status: "active", reason: undefined, fails: 0 } : x) }))}>reset</button>}
              {k.status === "depleted" && <button className="btn-ghost !px-2 !py-1 text-xs text-destructive" onClick={() => { const n = [...draft]; n[i] = ""; setDraft(n); setDirty(true); }}>kosongkan</button>}
            </div>
          );
        })}
      </div>
      <div className="card mt-6">
        <div className="label">Helius webhook (push events)</div>
        <p className="mt-1 text-sm text-muted-foreground">Point Helius enhanced webhooks (SWAP, TRANSFER, TOKEN_MINT) at your receiver URL for sub-second onchain updates.</p>
        <input className="inp mt-3" placeholder="https://your-receiver.example/helius" value={webhookUrl} onChange={(e) => setState(() => ({ webhookUrl: e.target.value }))} />
      </div>
    </>
  );
}
