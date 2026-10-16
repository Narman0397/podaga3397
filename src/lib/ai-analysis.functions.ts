import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({ address: z.string().min(32).max(64), kind: z.enum(["token", "wallet"]), scan: z.string().max(40_000) });

export interface AiSummary { text: string | null; error: string | null; status?: number }

const SYSTEM = `You are a senior Solana on-chain forensics analyst for memecoin snipers.
Using ONLY the scan JSON provided (never invent data; say "unverified" when missing), write a concise summary in Bahasa Indonesia with exactly these markdown sections:
## Fund Flow Anatomy
Capital origin (CEX, mixer, single funder, chained deployer), dispersion speed (funding window), synchronized buy timing.
## Cluster & Cabal Risk Matrix
Supply control danger, links to rugger/cabal tags in DB, dev-dump probability (Low/Medium/High) with reasons.
## Trader Verdict
First line exactly one of: VERDICT: SAFE PLAY | VERDICT: HIGH-RISK SCALP | VERDICT: AVOID / QUARANTINE. Then 2-3 actionable bullets.
Max 250 words.`;

export const analyzeScan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<AiSummary> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { text: null, error: "AI belum dikonfigurasi." };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: SYSTEM,
        input: `Target ${data.kind}: ${data.address}\nScan data:\n${data.scan}`,
        stream: true, store: false,
        reasoning: { effort: "low", summary: "auto" }, include: ["reasoning.encrypted_content"],
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      console.error("AI gateway", res.status, body);
      const msg = res.status === 402 ? "Kredit AI habis — tambahkan kredit di workspace." : res.status === 429 ? "Terlalu banyak permintaan AI, coba lagi sebentar." : res.status === 403 ? "Akses AI ditolak untuk workspace ini." : "AI gagal merespons.";
      return { text: null, error: msg, status: res.status };
    }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = "", text = "";
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(l.slice(5).trim()) as { type?: string; delta?: string };
          if (ev.type === "response.output_text.delta" && ev.delta) text += ev.delta;
        } catch { /* ignore */ }
      }
    }
    if (!text.trim()) return { text: null, error: "AI tidak mengembalikan ringkasan." };
    return { text, error: null };
  });
