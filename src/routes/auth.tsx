import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in — Solana Sentinel" },
    { name: "description", content: "Sign in to sync cluster memory and scan history across devices." },
    { property: "og:title", content: "Sign in — Solana Sentinel" },
    { property: "og:description", content: "Sync your wallet tags and scan history." },
  ] }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setMsg("");
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) setMsg(error.message); else nav({ to: "/" });
    } else {
      const { error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin } });
      setMsg(error ? error.message : "Cek email Anda untuk konfirmasi akun.");
    }
    setBusy(false);
  };
  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) setMsg(String(r.error.message ?? r.error)); else if (!r.redirected) nav({ to: "/" });
  };

  return (
    <>
      <PageHeader title={mode === "in" ? "Masuk" : "Daftar"} sub="Simpan Cluster Memory & Scan History di cloud, sinkron lintas perangkat." />
      <div className="card mx-auto max-w-sm space-y-3">
        <button className="btn w-full" onClick={google}>Lanjutkan dengan Google</button>
        <div className="text-center text-xs text-muted-foreground">atau</div>
        <input className="inp" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="inp" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn w-full" disabled={busy} onClick={submit}>{mode === "in" ? "Masuk" : "Daftar"}</button>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        <button className="w-full text-xs text-muted-foreground underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </div>
    </>
  );
}
