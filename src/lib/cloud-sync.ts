import { supabase } from "@/integrations/supabase/client";
import { getState, setState, subscribe, type MemoryEntry, type ScanEntry } from "./store";

let userId: string | null = null;
let prevMem: MemoryEntry[] = [];
let prevScan: ScanEntry[] = [];
let applying = false;
let started = false;

/* ---- Sync status (Master Plan Bernadya) ---- */
export type SyncStatus = "guest" | "loading" | "synced" | "saving" | "error";
let status: SyncStatus = "guest";
let statusEmail: string | null = null;
let snap: { status: SyncStatus; email: string | null } = { status, email: statusEmail };
const statusSubs = new Set<() => void>();
function emit() {
  if (snap.status !== status || snap.email !== statusEmail) snap = { status, email: statusEmail };
  statusSubs.forEach((f) => f());
}
function setStatus(s: SyncStatus) { status = s; emit(); }
const SERVER_SNAP = { status: "guest" as SyncStatus, email: null as string | null };
/** Cached snapshot: same reference until a field changes (React 19 safe). */
export function getSyncStatus() { return snap; }
export function getServerSyncStatus() { return SERVER_SNAP; }
export function subscribeSync(cb: () => void) { statusSubs.add(cb); return () => { statusSubs.delete(cb); }; }

const memRow = (m: MemoryEntry) => ({ user_id: userId!, address: m.address, tag: m.tag, note: m.note, seen: m.seen, perf: (m.perf ?? null) as never, created_at: new Date(m.at).toISOString() });
const scanRow = (s: ScanEntry) => ({ user_id: userId!, address: s.address, kind: s.kind, summary: s.summary, scanned_at: new Date(s.at).toISOString() });

async function push() {
  if (!userId || applying) return;
  const { memory, scanHistory } = getState();
  const mAdd = memory.filter((m) => !prevMem.some((p) => p.address === m.address && p.tag === m.tag && p.note === m.note && p.at === m.at && p.seen === m.seen && p.perf?.at === m.perf?.at));
  const sAdd = scanHistory.filter((s) => !prevScan.some((p) => p.address === s.address && p.at === s.at));
  // Cluster Memory is permanent: synchronization only inserts or updates wallets.
  prevMem = memory; prevScan = scanHistory;
  if (mAdd.length) await supabase.from("wallet_tags").upsert(mAdd.map(memRow), { onConflict: "user_id,address" });
  if (sAdd.length) await supabase.from("scan_history").upsert(sAdd.map(scanRow), { onConflict: "user_id,address" });
}

async function pull() {
  if (!userId) return;
  const [{ data: tags }, { data: scans }] = await Promise.all([
    supabase.from("wallet_tags").select("*"),
    supabase.from("scan_history").select("*").neq("kind", "topvol").order("scanned_at", { ascending: false }).limit(50),
  ]);
  const local = getState();
  const cloudMem: MemoryEntry[] = (tags ?? []).map((t) => ({ address: t.address, tag: t.tag as MemoryEntry["tag"], note: t.note, seen: t.seen, perf: (t.perf as MemoryEntry["perf"]) ?? null, at: Date.parse(t.created_at) }));
  const cloudScan: ScanEntry[] = (scans ?? []).map((s) => ({ address: s.address, kind: s.kind as ScanEntry["kind"], summary: s.summary, at: Date.parse(s.scanned_at) }));
  // Preserve every previously stored wallet; exchange filtering only applies before initial discovery.
  const memory = [...cloudMem, ...local.memory.filter((m) => !cloudMem.some((c) => c.address === m.address))];
  const scanHistory = [...cloudScan, ...local.scanHistory.filter((m) => !cloudScan.some((c) => c.address === m.address))].sort((a, b) => b.at - a.at).slice(0, 50);
  applying = true;
  setState(() => ({ memory, scanHistory }));
  applying = false;
  prevMem = cloudMem; prevScan = cloudScan;
  await push(); // upload local-only items
}

// ---- Full account state (Master Plan ABC) ----
const ACCOUNT_KEYS = ["keys", "rotation", "cursor", "webhookUrl", "alertFilter", "guard", "telegram", "discord", "balance", "positions", "trades", "equity", "blacklist", "autoSaveCluster", "alerts", "helius", "autoBuy", "autoBuyLog"] as const;
type AccountKey = typeof ACCOUNT_KEYS[number];
let stateReady = false;
let lastSent = "";
let timer: ReturnType<typeof setTimeout> | undefined;

function snapshot() {
  const s = getState();
  const out: Record<string, unknown> = {};
  for (const k of ACCOUNT_KEYS) out[k] = s[k];
  // runtime-only key health is recomputed, never persisted
  out["keys"] = s.keys.map((k) => ({ key: k.key, status: k.key ? "active" : "empty", cooldownUntil: 0, calls: 0, fails: 0 }));
  return out;
}

function schedulePushState() {
  if (!userId || !stateReady || applying) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const data = snapshot();
    const json = JSON.stringify(data);
    if (json === lastSent || !userId) return;
    // Anti-overwrite: never replace cloud keys with an all-empty pool.
    if (!(data["keys"] as { key: string }[]).some((k) => k.key)) {
      const { data: row } = await supabase.from("user_state").select("data").eq("user_id", userId).maybeSingle();
      const ck = ((row?.data as { keys?: { key: string }[] } | null)?.keys ?? []);
      if (ck.some((k) => k.key) && !allowClearKeys) data["keys"] = ck;
    }
    allowClearKeys = false;
    setStatus("saving");
    const { error } = await supabase.from("user_state").upsert({ user_id: userId, data: data as never, updated_at: new Date().toISOString() });
    if (error) { setStatus("error"); return; }
    lastSent = json;
    setStatus("synced");
  }, 800);
}
let allowClearKeys = false;
/** Call before intentionally clearing every key so the guard lets it through. */
export function allowKeyClear() { allowClearKeys = true; }
/** Push immediately (Save button). */
export function saveNow() { schedulePushState(); }

async function pullState() {
  if (!userId) return;
  stateReady = false;
  setStatus("loading");
  const { data: row, error } = await supabase.from("user_state").select("data").eq("user_id", userId).maybeSingle();
  const cloud = (row?.data ?? null) as Partial<Record<AccountKey, unknown>> | null;
  if (cloud && Object.keys(cloud).length) {
    const local = getState();
    // merge keys: cloud slots win, local-only keys fill empty slots
    const cloudKeys = (cloud.keys as typeof local.keys | undefined) ?? local.keys;
    const have = new Set(cloudKeys.map((k) => k.key).filter(Boolean));
    const extra = local.keys.map((k) => k.key).filter((k) => k && !have.has(k));
    const keys = cloudKeys.map((k) => (!k.key && extra.length ? { ...k, key: extra.shift()!, status: "active" as const } : k));
    applying = true;
    setState(() => ({ ...(cloud as object), keys }));
    applying = false;
  }
  if (error) { setStatus("error"); return; } // stay locked: no push over unknown cloud state
  stateReady = true;
  setStatus("synced");
  lastSent = "";
  schedulePushState();
}

export function startCloudSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribe(() => { void push(); schedulePushState(); });
  const onSession = (session: { user: { id: string; email?: string } } | null) => {
    const id = session?.user.id ?? null;
    statusEmail = session?.user.email ?? null; emit();
    if (id === userId) return;
    userId = id;
    stateReady = false;
    if (id) { void pull(); void pullState(); } else setStatus("guest");
  };
  void supabase.auth.getSession().then(({ data }) => onSession(data.session));
  supabase.auth.onAuthStateChange((_event, session) => onSession(session));
}
