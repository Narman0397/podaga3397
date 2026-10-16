import { isAutoTag, type MemoryEntry } from "@/lib/store";

export const WALLET_TAG_LABELS: Record<MemoryEntry["tag"], string> = {
  watch: "Pola Bundler, belum dinilai",
  cabal: "Kandidat Cabal",
  rugger: "Serial Rugger",
};

const TONES: Record<MemoryEntry["tag"], string> = {
  watch: "border-warn/40 text-warn",
  cabal: "border-signal/40 text-signal",
  rugger: "border-destructive/50 text-destructive",
};

export function WalletTag({ entry }: { entry: MemoryEntry }) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1 text-xs">
      <span className={`chip whitespace-normal ${TONES[entry.tag]}`}>{WALLET_TAG_LABELS[entry.tag]}</span>
      <span className="text-muted-foreground">{isAutoTag(entry) ? "Otomatis" : "Manual"} · {entry.seen} kemunculan</span>
      {entry.perf && <span className={`chip ${entry.perf.cls === "alpha" ? "border-signal/40 text-signal" : entry.perf.cls === "churner" ? "border-destructive/50 text-destructive" : "text-muted-foreground"}`} title={`${entry.perf.tokens} token · median hold ${entry.perf.holdSec}s`}>{entry.perf.cls === "alpha" ? "Alpha Whale" : entry.perf.cls === "churner" ? "Toxic Churner" : "Netral"} · WR {entry.perf.winRate}% · ROI {entry.perf.avgRoi}×</span>}
    </span>
  );
}