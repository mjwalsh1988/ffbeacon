import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAllSleeperTransactions, type SleeperTransaction } from "@/lib/sleeper";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { claimLookup } from "@/lib/on-the-clock/cache";
import { isValidLeagueId, sanitizeSleeperPlayerId } from "@/lib/on-the-clock/validation";
import type { HistoryFaab, HistoryPick, HistoryTransaction } from "@/lib/on-the-clock/trade-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/transactions?league_id=
 *
 * Returns every completed TRADE in a league, shaped to the asset references the
 * cockpit Trade History tab values against the FF Beacon board (the client never
 * calls Sleeper directly). Non-trade moves (waivers, free agents, commissioner
 * actions) are filtered out: this surface is trade-only.
 *
 * Guarded the same way as the rest of On The Clock: the x-requested-with header,
 * strict league-id validation, and the feature-enabled gate. Sleeper's transaction
 * feed is per-week, so we walk weeks 0..N once (getAllSleeperTransactions) and the
 * client caches the result for the session, lazy-loading only when the tab opens.
 *
 * Response: private, no-store.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/** Hard cap so a pathological league can't return an unbounded payload. */
const MAX_TRADES = 250;

/** Per-(ip, league) throttle window guarding the Sleeper transaction fan-out. */
const LOOKUP_WINDOW_SECONDS = 10;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

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
function normalizePicks(raw: unknown): HistoryPick[] {
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

function normalizeFaab(raw: unknown): HistoryFaab[] {
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
function normalizeAddsDrops(raw: Record<string, number> | null): Record<string, number> {
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

function shapeTrade(t: SleeperTransaction): HistoryTransaction {
  return {
    transactionId: String(t.transaction_id),
    status: typeof t.status === "string" ? t.status : "complete",
    week: toNum(t.week),
    createdAt: toNum(t.created),
    rosterIds: Array.isArray(t.roster_ids)
      ? t.roster_ids.filter((r): r is number => typeof r === "number")
      : [],
    adds: normalizeAddsDrops(t.adds),
    drops: normalizeAddsDrops(t.drops),
    picks: normalizePicks(t.draft_picks),
    faab: normalizeFaab(t.waiver_budget),
  };
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  const url = new URL(req.url);
  const leagueId = url.searchParams.get("league_id") ?? "";
  if (!isValidLeagueId(leagueId)) {
    return json({ error: "Invalid league id." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  // Durable abuse guard BEFORE the Sleeper fan-out (this walks the league's weekly
  // transaction feed). Keyed per (ip, league); fail closed if it cannot evaluate.
  let allowed: boolean;
  try {
    allowed = await claimLookup(admin, {
      ip: clientIp(req),
      username: `txns:${leagueId}`,
      windowSeconds: LOOKUP_WINDOW_SECONDS,
    });
  } catch (err) {
    console.error("[on-the-clock/transactions] lookup guard failed", err);
    return json({ error: "Try again in a moment." }, 503);
  }
  if (!allowed) {
    return json({ error: "Too many lookups. Try again in a few seconds." }, 429);
  }

  const all = await getAllSleeperTransactions(leagueId);
  const trades = all
    .filter((t) => t.type === "trade" && t.status !== "failed")
    .map(shapeTrade)
    // Newest first; transactions with no timestamp sink to the bottom.
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const truncated = trades.length > MAX_TRADES;

  return json({ ok: true, transactions: trades.slice(0, MAX_TRADES), truncated });
}
