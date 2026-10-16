import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts, type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startCloudSync } from "@/lib/cloud-sync";
import { pnlPct, startTracker, useTracker } from "@/lib/tracker";
import { startCabalStream } from "@/lib/stream";
import { Activity, KeyRound, GitFork, Rocket, ShieldCheck, Zap, Bell, Database, Wallet } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { useStore } from "../lib/store";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <Link to="/" className="btn mt-6">Go home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <button className="btn mt-6" onClick={() => { router.invalidate(); reset(); }}>Try again</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Solana Sentinel — On-Chain Flow & Cabal Intelligence" },
      { name: "description", content: "Trace Solana wallet clusters, audit tokens and paper-trade with guardrails." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Radar", icon: Activity },
  { to: "/scanner", label: "Scanner & Tree", icon: GitFork },
  { to: "/portfolio", label: "Portfolio & Settings", icon: Wallet },
] as const;
const SUB = [
  { to: "/trace", label: "Tracing Engine", icon: GitFork },
  { to: "/audit", label: "Safety Audit", icon: ShieldCheck },
  { to: "/lifecycle", label: "Pump.fun Lifecycle", icon: Rocket },
  { to: "/signals", label: "Signal Monitor", icon: Zap },
  { to: "/memory", label: "Cluster Memory", icon: Database },
  { to: "/wie", label: "Wallet Intelligence", icon: Brain },
  { to: "/paper", label: "Paper Trading", icon: Wallet },
  { to: "/keys", label: "Helius Key Pool", icon: KeyRound },
  { to: "/alerts", label: "Alert Delivery", icon: Bell },
] as const;

function Sidebar() {
  const keys = useStore((s) => s.keys);
  const active = keys.filter((k) => k.status === "active").length;
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card/40 p-4 backdrop-blur lg:flex">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-cyan" />
        <div>
          <div className="text-sm font-bold leading-none">SOLANA SENTINEL</div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">flow & cabal intel</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} activeOptions={{ exact: to === "/" }}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
            activeProps={{ className: "bg-accent !text-foreground shadow-inner" }}>
            <Icon className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>
      <div className="label mb-2 mt-6 px-3">Tools</div>
      <nav className="flex flex-col gap-0.5">
        {SUB.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            activeProps={{ className: "bg-accent !text-foreground" }}>
            <Icon className="h-3.5 w-3.5" />{label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto rounded-lg border bg-surface p-3">
        <div className="label">RPC Pool</div>
        <div className="mt-1 flex items-center gap-2 font-mono text-sm">
          <span className={`h-2 w-2 rounded-full ${active ? "bg-signal animate-pulse" : "bg-warn"}`} />
          {active ? `${active}/20 keys live` : "Simulation mode"}
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  return (
    <div className="flex gap-1 overflow-x-auto border-b bg-card/60 p-2 lg:hidden">
      {[...NAV, ...SUB].map(({ to, label }) => (
        <Link key={to} to={to} activeOptions={{ exact: to === "/" }} className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground"
          activeProps={{ className: "bg-accent !text-foreground" }}>{label}</Link>
      ))}
    </div>
  );
}

function PnlTicker() {
  const positions = useStore((s) => s.positions);
  const tr = useTracker();
  if (!positions.length) return null;
  const cost = positions.reduce((a, p) => a + p.sizeSol, 0);
  let val = 0, known = 0;
  for (const p of positions) { const v = pnlPct(p, tr.quotes[p.token], tr.sol); if (v !== null) { val += p.sizeSol * (1 + v / 100); known += p.sizeSol; } }
  const pct = known ? (val / known - 1) * 100 : null;
  return (
    <Link to="/paper" className="chip mr-auto font-mono">
      <span key={tr.tick} className="mr-1.5 inline-block h-1.5 w-1.5 animate-ping rounded-full bg-signal" />
      {positions.length} pos · {cost.toFixed(2)} SOL · <span className={pct === null ? "" : pct >= 0 ? "text-signal" : "text-destructive"}>{pct === null ? "…" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}</span>
    </Link>
  );
}

function AccountBadge() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <div className="mb-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <PnlTicker />
      {email ? (<><span className="chip">☁ Sinkron · {email}</span><button className="btn-ghost !py-1" onClick={() => supabase.auth.signOut()}>Keluar</button></>)
        : <Link to="/auth" className="btn-ghost !py-1">Masuk untuk sinkron cloud</Link>}
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => { startCloudSync(); startTracker(); startCabalStream(); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <MobileNav />
          <div className="mx-auto max-w-7xl p-4 md:p-8"><AccountBadge /><Outlet /></div>
        </main>
      </div>
    </QueryClientProvider>
  );
}
