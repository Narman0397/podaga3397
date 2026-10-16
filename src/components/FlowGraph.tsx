import { useState } from "react";
import type { Cluster } from "@/lib/sim";
import { short } from "@/lib/sim";
import { isAutoTag, memoryTag, useStore } from "@/lib/store";
import { WALLET_TAG_LABELS } from "@/components/WalletTag";

export function FlowGraph({ cluster, onSelect }: { cluster: Cluster; onSelect?: (id: string) => void }) {
  useStore((s) => s.memory);
  const [hover, setHover] = useState<string | null>(null);
  const W = 900, H = 460;
  const levels = [0, 1, 2].map((l) => cluster.nodes.filter((n) => n.level === l));
  const pos = new Map<string, { x: number; y: number }>();
  levels.forEach((ns, l) => ns.forEach((n, i) => pos.set(n.id, { x: 90 + l * 360, y: ((i + 1) * H) / (ns.length + 1) })));
  const maxSol = Math.max(...cluster.edges.map((e) => e.sol), 1);
  const related = (id: string) => hover && (id === hover || cluster.edges.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id)));

  return (
    <div className="overflow-x-auto rounded-xl border bg-surface/40">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[700px] w-full">
        <defs>
          <linearGradient id="eg" x1="0" x2="1"><stop offset="0" stopColor="var(--primary)" /><stop offset="1" stopColor="var(--cyan)" /></linearGradient>
        </defs>
        {["MASTER", "CHILD L1", "SUB-WALLET L2"].map((t, i) => (
          <text key={t} x={90 + i * 360} y={18} textAnchor="middle" fill="var(--muted-foreground)" fontSize="10" letterSpacing="2">{t}</text>
        ))}
        {cluster.edges.map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const mx = (a.x + b.x) / 2;
          const dim = hover && !(e.from === hover || e.to === hover);
          return (
            <path key={i} d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`} fill="none"
              stroke="url(#eg)" strokeWidth={1 + (e.sol / maxSol) * 5} opacity={dim ? 0.08 : 0.55}
              strokeDasharray="6 4" className="[animation:dash_1.2s_linear_infinite]" />
          );
        })}
        {cluster.nodes.map((n) => {
          const p = pos.get(n.id)!;
          const entry = memoryTag(n.id);
          const r = n.level === 0 ? 22 : 9 + Math.min(10, n.sol);
          const fill = n.level === 0 ? "var(--primary)" : n.bought ? "var(--signal)" : "var(--muted-foreground)";
          const dim = hover && !related(n.id);
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.25 : 1} className="cursor-pointer"
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(n.id)}>
              <title>{entry ? `${n.id} · ${WALLET_TAG_LABELS[entry.tag]} · ${isAutoTag(entry) ? "Otomatis" : "Manual"} · ${entry.seen} kemunculan` : n.id}</title>
              <circle r={r + 6} fill={fill} opacity={0.15} />
              <circle r={r} fill={fill} stroke="var(--background)" strokeWidth={2} />
              <text y={r + 14} textAnchor="middle" fill="var(--foreground)" fontSize="10" fontFamily="JetBrains Mono">{short(n.id)}</text>
              <text y={r + 26} textAnchor="middle" fill="var(--muted-foreground)" fontSize="9" fontFamily="JetBrains Mono">
                {n.sol} SOL{n.supplyPct ? ` · ${n.supplyPct}%` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <style>{`@keyframes dash{to{stroke-dashoffset:-20}}`}</style>
      <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />Master</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-signal" />Bought token</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-muted-foreground" />Holding SOL</span>
        <span className="ml-auto">Hover to isolate path · click to tag in memory</span>
      </div>
    </div>
  );
}
