import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ELIGIBLE_POSITIONS, readSleeperId } from "@/lib/ranking-boards";

/**
 * GET /api/breakdown/search?q=&limit=
 *
 * Public player autocomplete for the Beacon Breakdown comparison tool. Returns
 * ONLY safe identity fields (slug, name, position, team, sleeper id for the
 * headshot). It never returns values, ranks, or any private data. The slug is
 * included because Beacon Breakdown addresses players by slug in its shareable
 * URL (?a=<slug>&b=<slug>), unlike the Signal Check search which keys by id.
 *
 * Abuse safeguards mirror the Signal Check search route:
 *   - same-origin x-requested-with header check
 *   - minimum query length
 *   - hard result clamp
 *   - indexed, parameterized query; the query string is sanitized before the
 *     PostgREST or-filter and % / _ are escaped
 */

interface PlayerResult {
  slug: string;
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

const MIN_LENGTH = 2;

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const url = new URL(req.url);

  const rawQuery = (url.searchParams.get("q") ?? "").slice(0, 60);
  const query = rawQuery.replace(/[^\p{L}\p{N} '.\-]/gu, "").trim();

  if (query.length < MIN_LENGTH) {
    return NextResponse.json({ results: [], minLength: MIN_LENGTH });
  }

  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    30,
  );

  const escaped = query.replace(/[%_]/g, (m) => `\\${m}`);
  const { data, error } = await supabase
    .from("players")
    .select("id, slug, first_name, last_name, full_name, position, team, external_ids")
    .eq("status", "active")
    .or(`full_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`)
    .in("position", ELIGIBLE_POSITIONS as unknown as string[])
    .order("full_name", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error("[breakdown/search] query failed", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }

  const results: PlayerResult[] = (data ?? []).map((p) => ({
    slug: p.slug,
    playerId: p.id,
    name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    position: p.position,
    team: p.team,
    sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
  }));

  return NextResponse.json({ results, minLength: MIN_LENGTH });
}
