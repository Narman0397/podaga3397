import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/cluster-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace("Bearer ", "");
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { runClusterWorker } = await import("@/lib/cluster-worker.server");
        try {
          const r = await runClusterWorker();
          return Response.json({ ok: true, skipped: "skipped" in r, users: "users" in r ? r.users : 0 });
        } catch (e) {
          console.error(e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
