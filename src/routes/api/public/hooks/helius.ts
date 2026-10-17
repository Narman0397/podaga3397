import { createFileRoute } from "@tanstack/react-router";

// Helius enhanced webhook receiver: verifies the shared auth header, then runs an exit pass for mints that just traded.
export const Route = createFileRoute("/api/public/hooks/helius")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["HELIUS_WEBHOOK_SECRET"];
        const got = request.headers.get("authorization") ?? "";
        if (!secret || got.length !== secret.length) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let diff = 0; for (let i = 0; i < secret.length; i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i);
        if (diff) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as { tokenTransfers?: { mint?: string }[] }[] | null;
        if (!Array.isArray(body)) return Response.json({ error: "Bad payload" }, { status: 400 });
        const txs = body.slice(0, 200);
        const mints = [...new Set(txs.flatMap((t) => (t.tokenTransfers ?? []).map((x) => x.mint).filter((m): m is string => typeof m === "string" && m.length >= 32 && m.length <= 44)))].slice(0, 100);
        try {
          // Tere 2 Pilar B: realtime WIE ingest for tracked wallets (seconds, not cron minutes).
          const { ingestRealtime } = await import("@/lib/wallet-intelligence/realtime.server");
          const rt = await ingestRealtime(txs as never).catch((e) => { console.error("realtime", e); return null; });
          if (!mints.length) return Response.json({ ok: true, mints: 0, realtime: !!rt });
          const { runWebhookExits } = await import("@/lib/cluster-worker.server");
          const r = await runWebhookExits(mints);
          return Response.json({ ok: true, mints: mints.length, skipped: "skipped" in r, realtime: !!rt });
        } catch (e) {
          console.error(e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
