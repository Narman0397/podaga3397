// WIE V2.1 Phase 6 — evidence-based wallet graph (pure).
// Relations are observations with evidence, never proof of shared ownership.
import { CEX_HOT_WALLETS } from "../edge";

export const GRAPH_VERSION = "wie-graph-1.0.0";
export const GRAPH_LIMITS = { maxEvidence: 20, maxNodes: 60, maxEdges: 120, coEntryWindowSec: 60 };

export type RelationKind = "funding" | "co_entry";
export type RelationStatus = "observed" | "suspected" | "strong_evidence" | "rejected";

export interface GraphEvent {
  wallet: string;
  signature: string;
  block_time: string | null;
  activity: string;
  mint: string | null;
  direction: string | null;
  sol_amount: number | null;
  counterparty: string | null;
}

export interface Relation {
  wallet_a: string;
  wallet_b: string;
  relation: RelationKind;
  evidence: { signature: string; at: string | null; mint?: string | null; sol?: number | null }[];
  first_seen: string | null;
  last_seen: string | null;
  frequency: number;
  confidence: number;
  status: RelationStatus;
  reasons: string[];
  rule_version: string;
}

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

/**
 * Status rules (documented, deterministic):
 * - Exchange/known service counterparty → rejected (common false positive).
 * - funding: ≥3 transfers → strong_evidence, 2 → suspected, 1 → observed.
 * - co_entry (same token within 60s): ≥5 distinct tokens → suspected, otherwise observed.
 *   Timing/token similarity alone never reaches strong_evidence.
 */
export function relationStatus(kind: RelationKind, frequency: number, rejectedReason: string | null) {
  if (rejectedReason) return { status: "rejected" as const, confidence: 0 };
  if (kind === "funding") {
    const status = frequency >= 3 ? "strong_evidence" : frequency === 2 ? "suspected" : "observed";
    return { status: status as RelationStatus, confidence: Math.min(90, 30 + frequency * 20) };
  }
  return { status: (frequency >= 5 ? "suspected" : "observed") as RelationStatus, confidence: Math.min(60, frequency * 10) };
}

export function buildRelations(events: GraphEvent[], tracked: Set<string>, isService: (a: string) => string | null = (a) => CEX_HOT_WALLETS[a] ?? null): Relation[] {
  const acc = new Map<string, { a: string; b: string; kind: RelationKind; ev: Relation["evidence"]; keys: Set<string> }>();
  const add = (x: string, y: string, kind: RelationKind, key: string, e: Relation["evidence"][number]) => {
    if (x === y) return;
    const [a, b] = pair(x, y);
    const k = `${a}|${b}|${kind}`;
    const cur = acc.get(k) ?? { a, b, kind, ev: [], keys: new Set<string>() };
    if (cur.keys.has(key)) return; // retries / duplicate evidence never double count
    cur.keys.add(key);
    cur.ev.push(e);
    acc.set(k, cur);
  };
  for (const e of events)
    if (e.activity === "sol_transfer" && e.counterparty && e.sol_amount)
      add(e.wallet, e.counterparty, "funding", e.signature, { signature: e.signature, at: e.block_time, sol: e.sol_amount });

  const buys = events.filter((e) => e.activity === "buy" && e.mint && e.block_time && tracked.has(e.wallet));
  const byMint = new Map<string, GraphEvent[]>();
  for (const b of buys) byMint.set(b.mint!, [...(byMint.get(b.mint!) ?? []), b]);
  for (const [mint, list] of byMint) {
    list.sort((p, q) => Date.parse(p.block_time!) - Date.parse(q.block_time!));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const dt = (Date.parse(list[j].block_time!) - Date.parse(list[i].block_time!)) / 1000;
        if (dt > GRAPH_LIMITS.coEntryWindowSec) break;
        if (list[i].wallet !== list[j].wallet) add(list[i].wallet, list[j].wallet, "co_entry", mint, { signature: list[j].signature, at: list[j].block_time, mint });
      }
  }

  return [...acc.values()].map(({ a, b, kind, ev }) => {
    const times = ev.map((e) => e.at).filter((t): t is string => !!t).sort();
    const svc = isService(a) ?? isService(b);
    const { status, confidence } = relationStatus(kind, ev.length, svc);
    const reasons = svc
      ? [`melibatkan layanan/exchange (${svc}) — kemungkinan bukan relasi pemilik`]
      : kind === "funding"
        ? [`${ev.length} transfer SOL langsung antar wallet`]
        : [`membeli token yang sama dalam ≤${GRAPH_LIMITS.coEntryWindowSec} dtk pada ${ev.length} token (kesamaan waktu bukan bukti kepemilikan)`];
    return {
      wallet_a: a, wallet_b: b, relation: kind,
      evidence: ev.slice(-GRAPH_LIMITS.maxEvidence),
      first_seen: times[0] ?? null, last_seen: times[times.length - 1] ?? null,
      frequency: ev.length, confidence, status, reasons, rule_version: GRAPH_VERSION,
    };
  });
}

/** Bounded one-hop neighbourhood (no recursion) for UI rendering. */
export function neighbourhood<T extends Pick<Relation, "wallet_a" | "wallet_b" | "confidence">>(center: string, rels: T[], limits = GRAPH_LIMITS) {
  const edges = rels.filter((r) => r.wallet_a === center || r.wallet_b === center).sort((x, y) => y.confidence - x.confidence).slice(0, limits.maxEdges);
  const nodes = [center, ...new Set(edges.map((r) => (r.wallet_a === center ? r.wallet_b : r.wallet_a)))].slice(0, limits.maxNodes);
  const keep = new Set(nodes);
  return { nodes, edges: edges.filter((r) => keep.has(r.wallet_a) && keep.has(r.wallet_b)) };
}

/** Relationship score 0-100 from non-rejected relations; null when there is no evidence at all. */
export function relationshipScore(rels: Pick<Relation, "status" | "confidence">[]) {
  const live = rels.filter((r) => r.status !== "rejected");
  if (!live.length) return null;
  return Math.min(100, Math.round(live.reduce((s, r) => s + r.confidence, 0) / Math.max(1, live.length) + Math.min(20, live.length * 2)));
}
