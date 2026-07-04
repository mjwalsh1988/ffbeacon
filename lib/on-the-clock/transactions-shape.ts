/**
 * Shared shaping for Sleeper league trades: raw SleeperTransaction rows ->
 * HistoryTransaction (the wire/persisted shape the Trade History tab and the
 * awards engine consume).
 *
 * Extracted from app/api/on-the-clock/transactions/route.ts so the completed-
 * draft snapshot finalizer (lib/on-the-clock/draft-snapshot.ts) freezes trades
 * through EXACTLY the same normalization as the live route. Pure (no fetch, no
 * DB); Sleeper's untrusted payload shapes are normalized defensively:
 *   - draft_picks arrives as array OR object OR JSON string OR null,
 *   - adds/drops keys are Sleeper player ids that must pass the sanitizer
 *     allowlist before being used as object keys (prototype-pollution guard).
 */

import type { SleeperTransaction } from "@/lib/sleeper";
import { sanitizeSleeperPlayerId } from "./validation";
import type { HistoryFaab, HistoryPick, HistoryTransaction } from "./trade-history";

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Sleeper sends transaction draft_picks as an array OR an object OR a JSON string
 * OR null. Normalize every shape to HistoryPick[], dropping rows missing the fields
 * we rely on. Mirrors the league-pulse normalizeDraftPicks pattern.
 */
export function normalizeHistoryPicks(raw: unknown): HistoryPick[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (arr && typeof arr === "object" && !Array.isArray(arr)) {
    arr = Object.values(arr as Record<string, unknown>);
  }
  if (!Array.isArray(arr)) return [];

  const out: HistoryPick[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const season = toNum(o.season);
    const round = toNum(o.round);
    const originalRosterId = toNum(o.roster_id);
    if (season === null || round === null || originalRosterId === null) continue;
    out.push({
      season,
      round,
      originalRosterId,
      newOwnerRosterId: toNum(o.owner_id),
      previousOwnerRosterId: toNum(o.previous_owner_id),
    });
  }
  return out;
}

export function normalizeHistoryFaab(raw: unknown): HistoryFaab[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryFaab[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const sender = toNum(o.sender);
    const receiver = toNum(o.receiver);
    const amount = toNum(o.amount);
    if (sender === null || receiver === null || amount === null) continue;
    out.push({ sender, receiver, amount });
  }
  return out;
}

/**
 * Keep only valid (sanitized) Sleeper ids mapped to a numeric roster id. The
 * sanitizer's ^[A-Za-z0-9]{1,16}$ allowlist is what makes the bracket assignment
 * below safe: "__proto__" contains underscores and is rejected, so no key can reach
 * Object.prototype. Do NOT relax the sanitizer to accept separators.
 */
export function normalizeHistoryAddsDrops(raw: Record<string, number> | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = sanitizeSleeperPlayerId(key);
    const roster = toNum(value);
    if (!id || id === "0" || roster === null) continue;
    out[id] = roster;
  }
  return out;
}

export function shapeHistoryTrade(t: SleeperTransaction): HistoryTransaction {
  return {
    transactionId: String(t.transaction_id),
    status: typeof t.status === "string" ? t.status : "complete",
    week: toNum(t.week),
    createdAt: toNum(t.created),
    rosterIds: Array.isArray(t.roster_ids)
      ? t.roster_ids.filter((r): r is number => typeof r === "number")
      : [],
    adds: normalizeHistoryAddsDrops(t.adds),
    drops: normalizeHistoryAddsDrops(t.drops),
    picks: normalizeHistoryPicks(t.draft_picks),
    faab: normalizeHistoryFaab(t.waiver_budget),
  };
}

/**
 * Completed trades only (non-trade moves and failed trades dropped), shaped and
 * sorted newest first (missing timestamps sink to the bottom).
 */
export function shapeLeagueTrades(all: SleeperTransaction[]): HistoryTransaction[] {
  return all
    .filter((t) => t.type === "trade" && t.status !== "failed")
    .map(shapeHistoryTrade)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
