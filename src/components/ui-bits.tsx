import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "signal" | "risk" | "cyan" | "warn" | undefined }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={cn("mt-2 font-mono text-2xl font-semibold",
        tone === "signal" && "text-signal", tone === "risk" && "text-destructive",
        tone === "cyan" && "text-cyan", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

export function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className={cn("flex items-center justify-between rounded-lg border px-3 py-2.5",
      ok ? "border-signal/30 bg-signal/5" : "border-destructive/40 bg-destructive/10")}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {detail && <div className="font-mono text-xs text-muted-foreground">{detail}</div>}
      </div>
      <span className={cn("chip", ok ? "border-signal/40 text-signal" : "border-destructive/50 text-destructive")}>{ok ? "PASS" : "FAIL"}</span>
    </div>
  );
}

export function Progress({ value, tone = "primary" }: { value: number; tone?: "primary" | "signal" | "risk" }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface">
      <div className={cn("h-full rounded-full transition-all duration-700",
        tone === "primary" && "bg-gradient-to-r from-primary to-cyan",
        tone === "signal" && "bg-signal", tone === "risk" && "bg-destructive")}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
