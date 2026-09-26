import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ELIGIBLE_POSITIONS,
  readSleeperId,
  type SearchablePlayer,
} from "@/lib/ranking-boards";
import { searchFantasyPlayers, type SearchPool } from "@/lib/player-search";
import { IDP_POSITIONS } from "@/lib/site";

/**
 * GET /api/players/search?q=&position=&limit=
 *
 * Server-side player search backing the "My Rankings" add-player combobox and
 * the Free Agent Finder.
 * We do NOT ship the full ~8.6k active-player list to the client; the editor
 * queries this endpoint (debounced) instead.
 *
 * Auth: signed-in users only. Player rows are public data, but this surface is
 * dashboard-only so we gate it to authenticated users and reject cross-origin
 * callers with the same x-requested-with check used by the league refresh API.
 *
 * Results: active players whose name matches `q`, restricted to fantasy
 * positions (or a single position when `position` is one of QB/RB/WR/TE/K/DEF).
 *
 * `pool=ranked+idp` adds defenders who pass the IDP relevance gate (plan R-15).
 * The Free Agent Finder sends it, and so does a My Rankings board that holds
 * defenders (a DL, LB, DB or all-defenders board, or an overall board with
 * defenders switched on). Any other value is read as the default.
 *
 * `positions=DL,LB,DB` narrows to several positions at once (an all-defenders
 * board); entries outside the pool's allowed set are dropped.
 */
export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  // Strip everything that isn't a letter, number, space, apostrophe, hyphen,
  // or period. This keeps the PostgREST or-filter below injection-safe (commas
  // and parentheses are filter syntax) and matches real player-name characters.
  const rawQuery = (url.searchParams.get("q") ?? "").slice(0, 60);
  const query = rawQuery.replace(/[^\p{L}\p{N} '.\-]/gu, "").trim();
  if (query.length < 2) {
    return NextResponse.json({ players: [] satisfies SearchablePlayer[] });
  }

  const pool: SearchPool =
    url.searchParams.get("pool") === "ranked+idp" ? "ranked+idp" : "ranked";
  const allowedPositions: readonly string[] =
    pool === "ranked+idp"
      ? [...ELIGIBLE_POSITIONS, ...IDP_POSITIONS]
      : ELIGIBLE_POSITIONS;
  const positionParam = url.searchParams.get("position");
  const listParam = (url.searchParams.get("positions") ?? "")
    .split(",")
    .slice(0, 12)
    .filter((p) => allowedPositions.includes(p));
  const positions: readonly string[] =
    positionParam && allowedPositions.includes(positionParam)
      ? [positionParam]
      : listParam.length > 0
        ? listParam
        : allowedPositions;

  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 1),
    50,
  );

  let rows;
  try {
    rows = await searchFantasyPlayers(supabase, {
      query,
      limit,
      positions,
      pool,
    });
  } catch (error) {
    console.error("[players/search] query failed", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }

  const players: SearchablePlayer[] = rows.map((p) => ({
    playerId: p.id,
    slug: p.slug,
    name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    position: p.position ?? "",
    team: p.team,
    sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
  }));

  return NextResponse.json({ players });
}
