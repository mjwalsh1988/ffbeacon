/**
 * Relays: shared shapes.
 *
 * A Relay is one short structured headline made from one accepted source
 * post (docs/beacon-brief/relays-and-briefs-plan.md, section 3). It is never
 * rewritten into prose and never indexed. The classify call returns the
 * extraction (RelayExtraction), lib/relays/grounding.ts proves every number
 * and name in it came from the post, and lib/relays/write.ts stores it.
 */

import type { Database } from "@/lib/database.types";

export const RELAY_KINDS = [
  "injury",
  "transaction",
  "contract",
  "suspension",
  "depth_chart",
  "coaching",
  "performance",
  "draft",
  "legal",
  "other",
] as const;
export type RelayKind = (typeof RELAY_KINDS)[number];

export const RELAY_AVAILABILITIES = [
  "out",
  "doubtful",
  "questionable",
  "active",
  "ir",
  "pup",
  "released",
  "signed",
  "traded",
  "suspended",
  "waived",
  "none",
] as const;
export type RelayAvailability = (typeof RELAY_AVAILABILITIES)[number];

export const RELAY_STATUSES = ["published", "hidden", "retracted"] as const;
export type RelayStatus = (typeof RELAY_STATUSES)[number];

/** Limits enforced in code, and the same 20 to 240 the database CHECK carries.
 * The PROMPT asks for a narrower 40 to 220, so a model headline that lands just
 * outside its own range is still storable and an admin edit has room. */
export const RELAY_HEADLINE_MIN = 20;
export const RELAY_HEADLINE_MAX = 240;
export const RELAY_MAX_FACTS = 6;
export const RELAY_FACT_LABEL_MAX = 24;
export const RELAY_FACT_VALUE_MAX = 80;

export interface RelayFact {
  label: string;
  value: string;
}

/** The `relay` object the classify call returns, after normalisation. */
export interface RelayExtraction {
  headline: string;
  kind: RelayKind;
  facts: RelayFact[];
  timeline: string | null;
  availability: RelayAvailability;
}

export type RelayRow = Database["public"]["Tables"]["relays"]["Row"];
export type RelayInsert = Database["public"]["Tables"]["relays"]["Insert"];

/** Plain-language label for a kind, for chips and the admin filters. */
export const RELAY_KIND_LABELS: Record<RelayKind, string> = {
  injury: "Injury",
  transaction: "Transaction",
  contract: "Contract",
  suspension: "Suspension",
  depth_chart: "Depth chart",
  coaching: "Coaching",
  performance: "Performance",
  draft: "Draft",
  legal: "Legal",
  other: "News",
};

export function isRelayKind(value: unknown): value is RelayKind {
  return typeof value === "string" && (RELAY_KINDS as readonly string[]).includes(value);
}

export function isRelayAvailability(value: unknown): value is RelayAvailability {
  return (
    typeof value === "string" &&
    (RELAY_AVAILABILITIES as readonly string[]).includes(value)
  );
}

export function isRelayStatus(value: unknown): value is RelayStatus {
  return typeof value === "string" && (RELAY_STATUSES as readonly string[]).includes(value);
}

/** Parse the stored facts jsonb back into typed pairs, dropping malformed entries. */
export function parseRelayFacts(value: unknown): RelayFact[] {
  if (!Array.isArray(value)) return [];
  const out: RelayFact[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const label = (entry as { label?: unknown }).label;
    const val = (entry as { value?: unknown }).value;
    if (typeof label !== "string" || typeof val !== "string") continue;
    if (!label.trim() || !val.trim()) continue;
    out.push({ label: label.trim(), value: val.trim() });
    if (out.length >= RELAY_MAX_FACTS) break;
  }
  return out;
}
