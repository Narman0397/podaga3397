import { setState, useStore, DEFAULT_HELIUS, SCAN_INTERVALS } from "@/lib/store";
import { saveNow } from "@/lib/cloud-sync";

export function ScanIntervalSelect({ compact = false }: { compact?: boolean }) {
  const v = useStore((s) => s.helius?.scanInterval ?? 5);
  const set = (n: number) => { setState((s) => ({ helius: { ...DEFAULT_HELIUS, ...s.helius, scanInterval: n } })); saveNow(); };
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{compact ? "Idle scan cloud" : "Interval scan otomatis worker"}</span>
      <select className="inp w-auto !py-1 text-xs" value={v} onChange={(e) => set(Number(e.target.value))}>
        {SCAN_INTERVALS.map((n) => <option key={n} value={n}>{n} menit</option>)}
      </select>
      <span className="text-muted-foreground">≈ {Math.round(60 / v)} siklus/jam · maks ~{Math.round((60 / v) * 60)} request/jam</span>
    </label>
  );
}
