import { CEX_HOT_WALLETS, type WalletPerf } from "./edge";
import type { MemoryEntry } from "./store";

export interface InspectEvidence { subs: number; bundleScore: number; perf: WalletPerf | null; exchange: string | null }
export interface InspectResult { tag: MemoryEntry["tag"] | null; reason: string; note: string }

/** Pure auto-triage: decides which memory group (if any) an inspected wallet joins. */
export function classifyWallet(e: InspectEvidence): InspectResult {
  if (e.exchange) return { tag: null, reason: `Wallet bursa (${e.exchange}) — dilewati`, note: "" };
  const p = e.perf;
  const perfTxt = p ? `, WR ${p.winRate}% ROI ${p.avgRoi}× (${p.tokens} token)` : "";
  const base = `Funder ${e.subs} sub-wallet, bundle ${e.bundleScore}${perfTxt}, non-CEX`;
  let tag: MemoryEntry["tag"] | null = null;
  if ((p && p.cls === "churner" && e.subs >= 2) || (e.subs >= 5 && e.bundleScore > 70)) tag = "rugger";
  else if ((p && p.cls === "alpha") || (e.subs >= 3 && e.bundleScore >= 60)) tag = "cabal";
  else if (e.subs >= 2) tag = "watch";
  if (!tag) return { tag: null, reason: `Tidak ada pola cluster (${base})`, note: "" };
  return { tag, reason: base, note: `Auto: Inspeksi mandiri — ${base}` };
}

export async function inspectWallet(addr: string, blacklist: (a: string) => string | null): Promise<InspectEvidence> {
  const exchange = CEX_HOT_WALLETS[addr] ?? blacklist(addr);
  if (exchange) return { subs: 0, bundleScore: 0, perf: null, exchange };
  const { traceForward, trackRecord } = await import("./real");
  const [c, perf] = await Promise.all([traceForward(addr).catch(() => null), trackRecord(addr).catch(() => null)]);
  return { subs: c ? c.nodes.filter((n) => n.level === 1).length : 0, bundleScore: c?.bundleScore ?? 0, perf, exchange: null };
}
