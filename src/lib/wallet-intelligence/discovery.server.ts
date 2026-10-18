import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CEX_HOT_WALLETS, PUMP_PROGRAMS, type TopTok } from "../edge";
import { DISCOVERY_LIMITS, mergeCandidates, pickHolderCandidates } from "./discovery";
import { emptyCounters } from "./jobs";

/** Antarmuka minimal Helius yang dipakai discovery (diinjeksikan agar bisa diuji). */
export interface DiscoveryHelius {
  rpc: <T>(method: string, params: unknown[]) => Promise<T | null>;
}

type Supply = { value: { uiAmount: number } };
type Largest = { value: { address: string; uiAmount: number }[] };
type Owners = { value: ({ data: { parsed: { info: { owner: string } } } } | null)[] };

/** Ambil pemilik wallet di balik akun token terbesar sebuah mint. */
export async function discoverMintWallets(h: DiscoveryHelius, mint: string, perMint = DISCOVERY_LIMITS.holdersPerMint): Promise<string[]> {
  const [sup, big] = await Promise.all([h.rpc<Supply>("getTokenSupply", [mint]), h.rpc<Largest>("getTokenLargestAccounts", [mint])]);
  const total = sup?.value.uiAmount ?? 0;
  if (!big || !total) return [];
  const accs = big.value.slice(0, perMint + 4);
  const own = await h.rpc<Owners>("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
  const holders = accs.map((a, i) => ({ owner: own?.value[i]?.data?.parsed?.info?.owner ?? "", pct: (a.uiAmount / total) * 100 }));
  return pickHolderCandidates(holders, { perMint });
}

/** Daftarkan wallet ke antrean collector (wallet_collect_state) tanpa menimpa checkpoint yang ada. */
export async function enrollCollectState(wallets: string[]): Promise<number> {
  if (!wallets.length) return 0;
  const { data: existing } = await supabaseAdmin.from("wallet_collect_state").select("wallet").in("wallet", wallets);
  const have = new Set((existing ?? []).map((r) => r.wallet));
  const fresh = wallets.filter((w) => !have.has(w));
  if (!fresh.length) return 0;
  const { error } = await supabaseAdmin.from("wallet_collect_state").insert(fresh.map((wallet) => ({ wallet })));
  if (error) throw new Error(error.message);
  return fresh.length;
}

/** Tag wallet sebagai "watch" untuk tiap pengguna; tag manual yang sudah ada tidak ditimpa. */
export async function enrollTags(cands: Map<string, string>, userIds: string[], source: string): Promise<number> {
  let n = 0;
  for (const uid of userIds) {
    const { data: ex } = await supabaseAdmin.from("wallet_tags").select("address, tag, note, seen").eq("user_id", uid).in("address", [...cands.keys()]);
    const exMap = new Map((ex ?? []).map((e) => [e.address, e]));
    const rows = [...cands.entries()].map(([address, via]) => {
      const e = exMap.get(address);
      const note = `Auto: Discovery ${source} via ${via.slice(0, 6)}…`;
      return e
        ? { user_id: uid, address, tag: e.tag, note: e.note, seen: e.seen + 1 }
        : { user_id: uid, address, tag: "watch", note, seen: 1 };
    });
    const { error } = await supabaseAdmin.from("wallet_tags").upsert(rows, { onConflict: "user_id,address" });
    if (!error) n += rows.length;
  }
  return n;
}

/**
 * Opsi A — otomatis: tiap 6 jam worker memanen wallet dari token top-volume harian,
 * lalu mendaftarkannya ke collector WIE dan menandainya "watch" untuk semua pengguna aktif.
 */
export async function runDiscoveryJob(
  users: { id: string; keys: string[] }[],
  h: DiscoveryHelius,
  gate: (id: string, every: number) => Promise<true | null>,
) {
  if (!users.length || !(await gate("wie-discover", DISCOVERY_LIMITS.everyMs))) return null;
  const c = emptyCounters();
  const { data: tv } = await supabaseAdmin.from("cluster_worker").select("last_result").eq("id", "topvol").maybeSingle();
  const mints = ((((tv?.last_result as { tokens?: TopTok[] } | null)?.tokens) ?? []).filter((t) => t.tier !== "rejected").map((t) => t.mint)).slice(0, DISCOVERY_LIMITS.mintsPerRun);
  if (!mints.length) return { ...c, mints: 0, candidates: 0, enrolled: 0 };
  const byMint = new Map<string, string[]>();
  for (const mint of mints) {
    c.records_seen++;
    try {
      const wallets = await discoverMintWallets(h, mint);
      if (wallets.length) byMint.set(mint, wallets);
    } catch {
      c.error_count++;
    }
  }
  const cands = mergeCandidates(byMint);
  // Jangan daftarkan ulang wallet yang sudah dikenal sebagai program/bursa (pertahanan ganda).
  for (const w of [...cands.keys()]) if (PUMP_PROGRAMS.has(w) || CEX_HOT_WALLETS[w]) cands.delete(w);
  const enrolled = await enrollCollectState([...cands.keys()]);
  const tagged = await enrollTags(cands, users.map((u) => u.id), "worker");
  c.records_inserted += enrolled;
  c.records_updated += tagged;
  const res = { at: new Date().toISOString(), mints: mints.length, candidates: cands.size, enrolled, tagged };
  await supabaseAdmin.from("cluster_worker").update({ last_result: res as never }).eq("id", "wie-discover");
  return { ...c, ...res };
}
