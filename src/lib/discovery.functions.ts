import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const mintsSchema = z.object({ mints: z.array(z.string().regex(SOL_ADDR)).min(1).max(5) });
const enrollSchema = z.object({ wallets: z.array(z.object({ address: z.string().regex(SOL_ADDR), viaMint: z.string().regex(SOL_ADDR) })).min(1).max(60) });

export interface DiscoveredWallet {
  address: string;
  viaMint: string;
  alreadyTracked: boolean;
  perf: { winRate: number; avgRoi: number; tokens: number; cls: string } | null;
}

/** Opsi B — manual: bedah CA yang ditempel pengguna, pakai key Helius milik pengguna itu sendiri. */
export const discoverTokens = createServerFn({ method: "POST" })
  .inputValidator(mintsSchema)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ wallets: DiscoveredWallet[]; error?: string }> => {
    const { data: st } = await context.supabase.from("user_state").select("data").eq("user_id", context.userId).maybeSingle();
    const keys = (((st?.data as { keys?: { key: string; status?: string }[] } | null)?.keys) ?? [])
      .filter((k) => k.key && k.status !== "depleted")
      .map((k) => k.key);
    if (!keys.length) return { wallets: [], error: "Tambahkan key Helius aktif di halaman Keys dulu." };

    const { heliusRpc } = await import("./helius");
    const { discoverMintWallets } = await import("./wallet-intelligence/discovery.server");
    const h = { rpc: <T,>(m: string, p: unknown[]) => heliusRpc<T>(m, p) };
    void keys; // heliusRpc memakai pool key dari store lokal yang disinkronkan ke user_state.

    const byMint = new Map<string, string[]>();
    for (const mint of data.mints) {
      const wallets = await discoverMintWallets(h, mint).catch(() => []);
      if (wallets.length) byMint.set(mint, wallets);
    }
    const { mergeCandidates } = await import("./wallet-intelligence/discovery");
    const cands = mergeCandidates(byMint, 60);
    if (!cands.size) return { wallets: [], error: "Tidak ada pemegang memenuhi syarat (pool/bursa/>20% suplai disaring)." };

    const addrs = [...cands.keys()];
    const [{ data: tracked }, { data: tags }] = await Promise.all([
      context.supabase.from("wallet_collect_state").select("wallet").in("wallet", addrs),
      context.supabase.from("wallet_tags").select("address, perf").eq("user_id", context.userId).in("address", addrs),
    ]);
    const trackedSet = new Set((tracked ?? []).map((r) => r.wallet));
    const perfMap = new Map((tags ?? []).map((t) => [t.address, t.perf as DiscoveredWallet["perf"]]));
    return {
      wallets: addrs.map((address) => ({
        address,
        viaMint: cands.get(address)!,
        alreadyTracked: trackedSet.has(address),
        perf: perfMap.get(address) ?? null,
      })),
    };
  });

/** Daftarkan wallet pilihan pengguna: tag "watch" milik pengguna + antrean collector WIE. */
export const enrollDiscovered = createServerFn({ method: "POST" })
  .inputValidator(enrollSchema)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ tagged: number; enrolled: number }> => {
    const rows = data.wallets.map((w) => ({
      user_id: context.userId,
      address: w.address,
      tag: "watch",
      note: `Manual: Discovery via ${w.viaMint.slice(0, 6)}…`,
      seen: 1,
    }));
    // Tag lama tidak ditimpa: hanya tambah yang belum ada.
    const { data: ex } = await context.supabase.from("wallet_tags").select("address").eq("user_id", context.userId).in("address", rows.map((r) => r.address));
    const have = new Set((ex ?? []).map((e) => e.address));
    const fresh = rows.filter((r) => !have.has(r.address));
    if (fresh.length) {
      const { error } = await context.supabase.from("wallet_tags").insert(fresh);
      if (error) throw new Error(error.message);
    }
    const { enrollCollectState } = await import("./wallet-intelligence/discovery.server");
    const enrolled = await enrollCollectState(data.wallets.map((w) => w.address));
    return { tagged: fresh.length, enrolled };
  });
