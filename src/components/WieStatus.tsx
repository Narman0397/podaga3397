import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isStale } from "@/lib/wallet-intelligence/jobs";
import { attribute, type AttribSignal } from "@/lib/wallet-intelligence/signals";

type Run = { id: string; job_name: string; status: string; started_at: string; finished_at: string | null; duration_ms: number | null; records_seen: number; records_inserted: number; records_skipped: number; error_count: number; error_summary: string | null };
type View = { state: "loading" } | { state: "guest" } | { state: "error"; msg: string } | { state: "ok"; runs: Run[]; events: number | null; wallets: number | null; gaps: number | null; outcomes: number | null; scoreHistory: number | null; sig: { total: number; early: number; late: number; insufficient: number; copyable: number; attrib: ReturnType<typeof attribute> } };

const JOB_LABEL: Record<string, string> = {
  "wie-collect": "Collector wallet",
  "wie-outcomes": "Outcome Engine (F2)",
  "wie-score": "Alpha Scoring v2 (F3)",
  "wie-signals": "Sinyal, risiko & eksekusi (F4–5)",
  topvol: "Top volume harian",
  alpha: "Alpha Hunter",
};
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—");

/** WIE V2.1 Job Monitor + collector status. Real data only; empty and stale states shown explicitly. */
export function WieStatus() {
  const [v, setV] = useState<View>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (alive) setV({ state: "guest" }); return; }
      const [runs, ev, st, gap, out, sh, sg] = await Promise.all([
        supabase.from("wie_job_runs").select("id, job_name, status, started_at, finished_at, duration_ms, records_seen, records_inserted, records_skipped, error_count, error_summary").order("started_at", { ascending: false }).limit(20),
        supabase.from("wallet_events").select("id", { count: "exact", head: true }),
        supabase.from("wallet_collect_state").select("wallet", { count: "exact", head: true }),
        supabase.from("wallet_collect_state").select("wallet", { count: "exact", head: true }).eq("possible_gap", true),
        supabase.from("wallet_outcomes").select("id", { count: "exact", head: true }),
        supabase.from("wallet_score_history").select("id", { count: "exact", head: true }),
        supabase.from("wallet_signals").select("wallet, entry_status, horizons, execution").order("signal_at", { ascending: false }).limit(1000),
      ]);
      if (!alive) return;
      if (runs.error) { setV({ state: "error", msg: "Status job tidak dapat dimuat." }); return; }
      setV({ state: "ok", runs: (runs.data ?? []) as Run[], events: ev.count, wallets: st.count, gaps: gap.count, outcomes: out.count, scoreHistory: sh.count, sig: summarize(sg.data ?? []) });
    })();
    return () => { alive = false; };
  }, []);

  if (v.state === "loading") return <div className="card mb-6 text-sm text-muted-foreground">Memuat status WIE…</div>;
  if (v.state === "guest") return <div className="card mb-6 text-sm text-muted-foreground">Masuk untuk melihat status Wallet Intelligence Engine.</div>;
  if (v.state === "error") return <div className="card mb-6 text-sm text-destructive">{v.msg}</div>;

  const lastCollect = v.runs.find((r) => r.job_name === "wie-collect" && r.status !== "skipped");
  const stale = isStale(lastCollect?.finished_at, 2 * 3_600_000);
  return (
    <section className="card mb-6 space-y-4" aria-label="Status Wallet Intelligence Engine">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">WIE V2.1 · Job Monitor</h2>
        <span className={stale ? "text-xs text-warn" : "text-xs text-signal"}>
          {lastCollect ? (stale ? `Data collector usang · terakhir ${fmt(lastCollect.finished_at)}` : `Collector aktif · ${fmt(lastCollect.finished_at)}`) : "Collector belum pernah berjalan (butuh key Helius aktif)"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Mini label="Event wallet" value={v.events ?? "—"} />
        <Mini label="Wallet dipantau" value={v.wallets ?? "—"} />
        <Mini label="Celah histori" value={v.gaps ?? "—"} />
        <Mini label="Outcome (F2)" value={v.outcomes ?? "—"} />
        <Mini label="Skor tersimpan (F3)" value={v.scoreHistory ?? "—"} />
        <Mini label="Sinyal (F4)" value={v.sig.total} />
        <Mini label="Awal / Telat / Data kurang" value={`${v.sig.early}/${v.sig.late}/${v.sig.insufficient}`} />
        <Mini label="Bisa ditiru (F5)" value={v.sig.copyable} />
        <Mini label="Wallet prediktif (1j)" value={v.sig.attrib.filter((a) => a.verdict === "PREDICTIVE").length} />
        <Mini label="Job gagal" value={v.runs.filter((r) => r.status === "failed").length} />
      </div>
      {v.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada riwayat job. Riwayat muncul setelah worker latar belakang berjalan.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground"><tr><th className="py-1 pr-3">Job</th><th className="pr-3">Status</th><th className="pr-3">Mulai</th><th className="pr-3">Durasi</th><th className="pr-3">Dilihat/Baru/Lewat</th><th>Error</th></tr></thead>
            <tbody>
              {v.runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1 pr-3">{JOB_LABEL[r.job_name] ?? r.job_name}</td>
                  <td className={r.status === "failed" ? "pr-3 text-destructive" : r.status === "success" ? "pr-3 text-signal" : "pr-3 text-muted-foreground"}>{r.status}</td>
                  <td className="pr-3 font-mono">{fmt(r.started_at)}</td>
                  <td className="pr-3 font-mono">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="pr-3 font-mono">{r.records_seen}/{r.records_inserted}/{r.records_skipped}</td>
                  <td className="max-w-[16rem] truncate text-muted-foreground" title={r.error_summary ?? ""}>{r.error_summary ?? (r.error_count ? `${r.error_count} error` : "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Sinyal hanya untuk simulasi/paper; risiko rendah bukan jaminan aman dan atribusi bersifat korelasi, bukan sebab-akibat.</p>
      <p className="text-xs text-muted-foreground">Histori dari sumber hanya mencakup transaksi terbaru yang dikembalikan penyedia data; tidak diklaim lengkap.</p>
    </section>
  );
}

type SigRow = { wallet: string; entry_status: string; horizons: unknown; execution: unknown };
function summarize(rows: SigRow[]) {
  const ex = (r: SigRow) => (r.execution ?? {}) as { copyable?: string; roundTripCostPct?: number | null };
  const signals: AttribSignal[] = rows.map((r) => ({ wallet: r.wallet, status: r.entry_status as AttribSignal["status"], horizons: (r.horizons ?? {}) as AttribSignal["horizons"], costPct: ex(r).roundTripCostPct ?? null }));
  return {
    total: rows.length,
    early: rows.filter((r) => r.entry_status === "EARLY").length,
    late: rows.filter((r) => r.entry_status === "LATE").length,
    insufficient: rows.filter((r) => r.entry_status === "INSUFFICIENT_DATA").length,
    copyable: rows.filter((r) => ex(r).copyable === "yes").length,
    attrib: attribute(signals),
  };
}

function Mini({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg font-semibold">{value}</div></div>;
}
