import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" aria-label="Salin alamat" title="Salin" className="text-muted-foreground hover:text-foreground"
      onClick={() => { void navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {ok ? <Check className="h-3 w-3 text-signal" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
