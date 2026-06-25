import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ELIGIBLE_POSITIONS, readSleeperId } from "@/lib/ranking-boards";
import { parsePickName } from "@/lib/ktc-picks";
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

const ORDINALS: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

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

function buildPickResults(query: string): PickResult[] {
  const parsed = parsePickName(query);
  if (!parsed) return [];
  const ord = ORDINALS[parsed.round] ?? `Round ${parsed.round}`;
  const explicitBucket = /\b(early|mid|late)\b/i.test(query);
  if (explicitBucket && parsed.pick_position !== "unknown") {
    return [
      {
        kind: "pick",
        season: parsed.season,
        round: parsed.round,
        pickPosition: parsed.pick_position,
        label: `${parsed.season} ${ord} (${parsed.pick_position})`,
      },
    ];
  }
  // No explicit bucket: offer a generic pick plus the three buckets.
  const buckets: ("early" | "mid" | "late")[] = ["early", "mid", "late"];
  return [
    { kind: "pick", season: parsed.season, round: parsed.round, pickPosition: null, label: `${parsed.season} ${ord}` },
    ...buckets.map((b) => ({
      kind: "pick" as const,
      season: parsed.season,
      round: parsed.round,
      pickPosition: b,
      label: `${parsed.season} ${ord} (${b})`,
    })),
  ];
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

  const escaped = query.replace(/[%_]/g, (m) => `\\${m}`);
  const { data, error } = await supabase
    .from("players")
    .select("id, first_name, last_name, full_name, position, team, external_ids")
    .eq("status", "active")
    .or(`full_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`)
    .in("position", ELIGIBLE_POSITIONS as unknown as string[])
    .order("full_name", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error("[signal-check/search] query failed", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }

  const players: PlayerResult[] = (data ?? []).map((p) => ({
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
