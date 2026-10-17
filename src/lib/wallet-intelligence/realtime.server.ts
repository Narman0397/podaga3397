// Tere 2 Pilar B — realtime ingest: Helius webhook txs for tracked wallets go straight to
// wallet_events and trigger an immediate signal pass, so detection delay drops to seconds.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeWalletTxs } from "./normalize";
import { withJobRun } from "./job-runs.server";
import { runSignalJob } from "./signal-jobs.server";
import type { RawEnhancedTx } from "./types";

type Tx = RawEnhancedTx & { feePayer?: string };

export async function ingestRealtime(txs: Tx[]) {
  const cands = new Set<string>();
  for (const t of txs) {
    if (t.feePayer) cands.add(t.feePayer);
    for (const n of t.nativeTransfers ?? []) { if (n.fromUserAccount) cands.add(n.fromUserAccount); if (n.toUserAccount) cands.add(n.toUserAccount); }
    for (const n of t.tokenTransfers ?? []) { if (n.fromUserAccount) cands.add(n.fromUserAccount); if (n.toUserAccount) cands.add(n.toUserAccount); }
  }
  if (!cands.size) return { wallets: 0, events: 0 };
  const list = [...cands].slice(0, 500);
  const { data } = await supabaseAdmin.from("wallet_collect_state").select("wallet").in("wallet", list);
  const tracked = (data ?? []).map((r) => r.wallet);
  if (!tracked.length) return { wallets: 0, events: 0 };
  return withJobRun("wie-realtime", "webhook", async () => {
    const events = tracked.flatMap((w) => normalizeWalletTxs(w, txs, "helius-webhook").events);
    if (events.length) {
      const { error } = await supabaseAdmin.from("wallet_events").upsert(events as never, { onConflict: "signature,wallet,event_index", ignoreDuplicates: true });
      if (error) throw new Error(`realtime upsert: ${error.message}`);
    }
    if (events.some((e) => e.activity === "buy")) await runSignalJob(true);
    return { records_seen: txs.length, records_inserted: events.length, meta: { wallets: tracked.length } };
  });
}
