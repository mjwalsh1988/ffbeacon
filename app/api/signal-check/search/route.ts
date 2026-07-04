import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readSleeperId } from "@/lib/ranking-boards";
import { searchFantasyPlayers } from "@/lib/player-search";
import { DEFAULT_SETTINGS } from "@/lib/signal-check/settings";

/**
 * GET /api/signal-check/search?q=&format=&limit=
 *
 * Public asset autocomplete for the Signal Check builder. Returns ONLY safe
 * search fields (name, position, team, sleeper id for the headshot). It never
 * returns player values, adjusted values, or any private/internal data.
 *
 * Abuse safeguards (no DB-backed rate limiter by design):
 *   - same-origin x-requested-with header check
 *   - minimum query length (admin-configurable, default 4)
 *   - hard result clamp
 *   - indexed, parameterized query; query string is sanitized before the
 *     PostgREST or-filter
 *
 * Draft picks are dynasty-only: pick suggestions are returned ONLY when the
 * resolved format is a dynasty format. Redraft formats return players only.
 */

interface PlayerResult {
  kind: "player";
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

interface PickResult {
  kind: "pick";
  season: number;
  round: number;
  pickPosition: "early" | "mid" | "late" | null;
  label: string;
}

const ORDINALS: Record<number, string> = {
  1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th", 7: "7th",
};

// A bare year expands to this many rounds (the rounds KTC actually publishes
// pick values for). An explicitly typed round is still honored beyond this.
const GENERATED_ROUNDS = 4;

type PickBucket = "early" | "mid" | "late";
const PICK_BUCKETS: PickBucket[] = ["early", "mid", "late"];

function ordinalFor(round: number): string {
  return ORDINALS[round] ?? `Round ${round}`;
}

async function autocompleteMinLength(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<number> {
  const { data } = await supabase
    .from("beacon_settings")
    .select("value")
    .eq("key", "signal_check_autocomplete_min")
    .maybeSingle();
  const v = data?.value as unknown;
  const n = typeof v === "number" ? v : DEFAULT_SETTINGS.autocompleteMinLength;
  // Never allow below 3, default 4.
  return Math.max(3, Math.floor(n) || DEFAULT_SETTINGS.autocompleteMinLength);
}

/**
 * Loose pick suggestions for the trade builder. Picks surface as soon as a year
 * is present, and every suggestion is an explicit early/mid/late slot so each
 * option carries its own distinct value (the slot-agnostic "whole round" option
 * is intentionally not offered, since it has no unique value of its own):
 *   "2027"          -> all four rounds, each as early/mid/late (12 options)
 *   "2027 1"        -> 2027 1st Early, Mid, Late
 *   "2027 1 early"  -> just that one slotted pick
 * A bucket typed without a round applies across every round.
 *
 * The data carries only early/mid/late buckets per (season, round) for every
 * season. There are no exact pick slots (e.g. 1.01) in the system, so even the
 * current draft year is offered as buckets, not numbered picks.
 */
function buildPickResults(query: string): PickResult[] {
  const yearMatch = query.match(/\b(20\d{2})\b/);
  if (!yearMatch) return [];
  const season = Number(yearMatch[1]);

  // Drop the year before scanning for a round so a bare round digit (the "1" in
  // "2027 1") cannot collide with the four-digit year.
  const rest = query.replace(yearMatch[0], " ");
  const bucketMatch = rest.toLowerCase().match(/\b(early|mid|late)\b/);
  const oneBucket = (bucketMatch?.[1] as PickBucket | undefined) ?? null;
  // A round is a 1-7 digit with an optional ordinal suffix: "1" or "1st".
  const roundMatch = rest.match(/\b([1-7])(?:st|nd|rd|th)?\b/i);
  const oneRound = roundMatch ? Number(roundMatch[1]) : null;

  const rounds =
    oneRound !== null ? [oneRound] : Array.from({ length: GENERATED_ROUNDS }, (_, i) => i + 1);
  const buckets = oneBucket ? [oneBucket] : PICK_BUCKETS;

  return rounds.flatMap((round) =>
    buckets.map((bucket) => ({
      kind: "pick" as const,
      season,
      round,
      pickPosition: bucket,
      label: `${season} ${ordinalFor(round)} (${bucket[0].toUpperCase()}${bucket.slice(1)})`,
    })),
  );
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const url = new URL(req.url);

  const rawQuery = (url.searchParams.get("q") ?? "").slice(0, 60);
  const query = rawQuery.replace(/[^\p{L}\p{N} '.\-]/gu, "").trim();

  const minLen = await autocompleteMinLength(supabase);
  if (query.length < minLen) {
    return NextResponse.json({ results: [], minLength: minLen });
  }

  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    40,
  );

  const formatSlug = (url.searchParams.get("format") ?? "").slice(0, 64);
  let allowsPicks = false;
  if (/^[a-z0-9-]{1,64}$/.test(formatSlug)) {
    const { data: fc } = await supabase
      .from("format_configs")
      .select("league_type")
      .eq("slug", formatSlug)
      .maybeSingle();
    allowsPicks = fc?.league_type === "dynasty";
  }

  let rows;
  try {
    rows = await searchFantasyPlayers(supabase, { query, limit });
  } catch (error) {
    console.error("[signal-check/search] query failed", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }

  const players: PlayerResult[] = rows.map((p) => ({
    kind: "player",
    playerId: p.id,
    name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    position: p.position,
    team: p.team,
    sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
  }));

  const picks: PickResult[] = allowsPicks ? buildPickResults(query) : [];

  return NextResponse.json({ results: [...picks, ...players], minLength: minLen });
}
