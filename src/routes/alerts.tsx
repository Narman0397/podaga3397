import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui-bits";
import { pushAlert, setState, useStore } from "@/lib/store";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [
    { title: "Alert Delivery — Solana Sentinel" },
    { name: "description", content: "Configure Telegram bot and Discord webhook for instant alerts." },
    { property: "og:title", content: "Alert Delivery — Solana Sentinel" },
    { property: "og:description", content: "Telegram and Discord alert delivery." },
  ] }),
  component: Alerts,
});

function Alerts() {
  const { telegram, discord, guard } = useStore((s) => s);
  const setG = (k: keyof typeof guard, v: number) => setState((s) => ({ guard: { ...s.guard, [k]: v } }));
  return (
    <>
      <PageHeader title="Alert Delivery" sub="Push every signal straight to your phone." right={<button className="btn" onClick={() => pushAlert("info", "Test alert from Solana Sentinel ✅")}>Send test alert</button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><div className="label">Telegram bot</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={telegram.enabled} onChange={(e) => setState((s) => ({ telegram: { ...s.telegram, enabled: e.target.checked } }))} />Enabled</label></div>
          <input className="inp" type="password" placeholder="Bot token from @BotFather" defaultValue={telegram.token} onBlur={(e) => setState((s) => ({ telegram: { ...s.telegram, token: e.target.value.trim() } }))} />
          <input className="inp" placeholder="Chat ID" defaultValue={telegram.chatId} onBlur={(e) => setState((s) => ({ telegram: { ...s.telegram, chatId: e.target.value.trim() } }))} />
        </div>
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><div className="label">Discord webhook</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={discord.enabled} onChange={(e) => setState((s) => ({ discord: { ...s.discord, enabled: e.target.checked } }))} />Enabled</label></div>
          <input className="inp" type="password" placeholder="https://discord.com/api/webhooks/…" defaultValue={discord.url} onBlur={(e) => setState((s) => ({ discord: { ...s.discord, url: e.target.value.trim() } }))} />
        </div>
      </div>
      <div className="card mt-4">
        <div className="label mb-3">Guardrail thresholds</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Cluster supply cap (%)<input className="inp mt-1" type="number" value={guard.clusterCap} onChange={(e) => setG("clusterCap", +e.target.value)} /></label>
          <label className="text-sm">Min liquidity ($)<input className="inp mt-1" type="number" value={guard.minLp} onChange={(e) => setG("minLp", +e.target.value)} /></label>
          <label className="text-sm">Max price impact (%)<input className="inp mt-1" type="number" value={guard.maxImpact} onChange={(e) => setG("maxImpact", +e.target.value)} /></label>
        </div>
      </div>
    </>
  );
}
