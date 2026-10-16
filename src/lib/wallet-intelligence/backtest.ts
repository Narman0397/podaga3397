// WIE V2.1 Phase 7 — temporal backtest (pure). Chronological train/test split; only decisions
// made at signal time are used; missed/unfinished horizons are counted, never dropped or backfilled.

export const BACKTEST_VERSION = "wie-bt-1.0.0";

export interface BtSignal {
  signal_at: string;
  decision: string | null;
  ret_pct: number | null;   // horizon return (null = no price / not finished)
  finished: boolean;        // horizon sample exists (incl. missed)
  cost_pct: number | null;
}

export function metrics(rets: number[]) {
  const n = rets.length;
  if (!n) return { n: 0, winRate: null, expectancy: null, profitFactor: null, maxDrawdownPct: null };
  const wins = rets.filter((r) => r > 0), losses = rets.filter((r) => r <= 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  let eq = 100, peak = 100, dd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak); }
  return {
    n,
    winRate: Math.round((wins.length / n) * 100),
    expectancy: +(rets.reduce((a, b) => a + b, 0) / n).toFixed(2),
    profitFactor: gl > 0 ? +(wins.reduce((a, b) => a + b, 0) / gl).toFixed(2) : null,
    maxDrawdownPct: +(dd * 100).toFixed(2),
  };
}

/** Net return after cost. A finished horizon with no price is a total loss (failed/illiquid token kept, not dropped). */
const net = (s: BtSignal) => (s.ret_pct == null ? -100 : s.ret_pct) - (s.cost_pct ?? 0);

export function runBacktest(signals: BtSignal[], trainShare = 0.6, minTest = 20) {
  const done = signals.filter((s) => s.finished).sort((a, b) => Date.parse(a.signal_at) - Date.parse(b.signal_at));
  const pending = signals.length - done.length;
  const cut = Math.floor(done.length * trainShare);
  const train = done.slice(0, cut), test = done.slice(cut);
  const accepted = (xs: BtSignal[]) => xs.filter((s) => s.decision === "ACCEPT").map(net);
  const warnings: string[] = [];
  if (test.length < minTest) warnings.push(`sampel uji kecil (${test.length} < ${minTest}) — hasil tidak dapat diandalkan`);
  if (!accepted(test).length) warnings.push("tidak ada sinyal ACCEPT di periode uji");
  if (pending) warnings.push(`${pending} sinyal horizonnya belum selesai — tidak dihitung`);
  warnings.push("backtest tidak membuktikan strategi menguntungkan");
  const span = (xs: BtSignal[]) => ({ from: xs[0]?.signal_at ?? null, to: xs[xs.length - 1]?.signal_at ?? null });
  return {
    train: { ...metrics(accepted(train)), ...span(train) },
    test: { ...metrics(accepted(test)), ...span(test) },
    // Baseline: take every finished signal in the test period, no gate.
    baseline: metrics(test.map(net)),
    warnings,
    version: BACKTEST_VERSION,
  };
}
