import { createServerFn } from "@tanstack/react-start";

export interface TipFloor { p25: number; p50: number; p75: number; p95: number; recommended: number; at: string }

/** Real Jito landed-tip percentiles (SOL). Proxied server-side because Jito blocks browser CORS. */
export const getJitoTip = createServerFn({ method: "GET" }).handler(async (): Promise<TipFloor | null> => {
  try {
    const r = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor");
    const j = (await r.json()) as Array<Record<string, number | string>>;
    const x = j[0]; if (!x) return null;
    const p75 = Number(x["landed_tips_75th_percentile"]);
    return {
      p25: Number(x["landed_tips_25th_percentile"]), p50: Number(x["landed_tips_50th_percentile"]),
      p75, p95: Number(x["landed_tips_95th_percentile"]), recommended: p75, at: String(x["time"]),
    };
  } catch { return null; }
});
