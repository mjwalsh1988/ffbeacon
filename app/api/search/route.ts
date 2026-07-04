import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readSleeperId } from "@/lib/ranking-boards";
import { searchFantasyPlayers } from "@/lib/player-search";

/**
 * GET /api/search?q=&limit=
 *
 * Public site-wide search backing the header search palette. Returns matching
 * players and published articles. Tools are a small static list matched on the
 * client, so this endpoint stays focused on the two DB-backed content types.
 *
 * Player results carry ONLY safe display fields (name, position, team, and the
 * Sleeper id used for the headshot). No player values or format/source-derived
 * numbers are exposed here, so the response is format-agnostic and the surface
 * does not need to resolve source/format. The player and article destination
 * pages apply the viewer's source/format themselves.
 *
 * Abuse safeguards (no DB-backed rate limiter by design):
 *   - same-origin x-requested-with header check
 *   - minimum query length
 *   - hard result clamps
 *   - indexed, parameterized queries; the query string is sanitized before the
 *     PostgREST or-filter (commas and parentheses are filter syntax)
 */

const MIN_QUERY_LENGTH = 2;
const PLAYER_LIMIT = 6;
const ARTICLE_LIMIT = 5;

interface PlayerResult {
  kind: "player";
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

interface ArticleResult {
  kind: "article";
  slug: string;
  title: string;
  tlDr: string | null;
  articleType: string;
  publishedAt: string | null;
}

/**
 * Relevance sort for player name matches: exact prefix matches first, then
 * anywhere-in-name matches, then alphabetical. Postgres ilike can't express
 * this ranking cheaply, so we over-fetch and sort the small result set here.
 */
function rankPlayers(rows: PlayerResult[], query: string): PlayerResult[] {
  const q = query.toLowerCase();
  return [...rows].sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    const aStarts = an.startsWith(q) ? 0 : 1;
    const bStarts = bn.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return an.localeCompare(bn);
  });
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const url = new URL(req.url);
  // Strip everything that isn't a letter, number, space, apostrophe, hyphen, or
  // period. Keeps the PostgREST or-filter injection-safe and matches the real
  // characters found in player names and article titles.
  const rawQuery = (url.searchParams.get("q") ?? "").slice(0, 60);
  const query = rawQuery.replace(/[^\p{L}\p{N} '.\-]/gu, "").trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({
      players: [] as PlayerResult[],
      articles: [] as ArticleResult[],
      minLength: MIN_QUERY_LENGTH,
    });
  }

  const supabase = await createClient();
  const escaped = query.replace(/[%_]/g, (m) => `\\${m}`);

  // Players are filtered to active, currently-ranked (fantasy relevant) players
  // in the six fantasy positions by the shared helper. We over-fetch so
  // rankPlayers has room to promote prefix matches before we slice to
  // PLAYER_LIMIT.
  const [playerRows, articleRes] = await Promise.all([
    searchFantasyPlayers(supabase, {
      query,
      limit: PLAYER_LIMIT * 4,
    }).catch((err) => {
      console.error("[search] player query failed", err);
      return [];
    }),
    supabase
      .from("articles")
      .select("slug, title, tl_dr, article_type, published_at")
      .eq("status", "published")
      .or(
        `title.ilike.%${escaped}%,tl_dr.ilike.%${escaped}%,meta_description.ilike.%${escaped}%`,
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(ARTICLE_LIMIT),
  ]);

  if (articleRes.error) {
    console.error("[search] article query failed", articleRes.error);
  }

  const players: PlayerResult[] = rankPlayers(
    playerRows.map((p) => ({
      kind: "player" as const,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team,
      sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
    })),
    query,
  ).slice(0, PLAYER_LIMIT);

  const articles: ArticleResult[] = (articleRes.data ?? []).map((a) => ({
    kind: "article" as const,
    slug: a.slug,
    title: a.title,
    tlDr: a.tl_dr,
    articleType: a.article_type,
    publishedAt: a.published_at,
  }));

  return NextResponse.json({ players, articles, minLength: MIN_QUERY_LENGTH });
}
