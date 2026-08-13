/**
 * Read side for the Beacon Steals board.
 *
 * The draft guide renders from here. Everything is already computed and stored
 * by the nightly build, so this is a single indexed read per bucket plus one
 * player join. No scoring, no model, no Sleeper.
 *
 * draft_value_targets is public-SELECT, so this runs on the ordinary server
 * client rather than needing service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { StealCategory } from "./engine";

type Client = SupabaseClient<Database>;

/** One row as the guide renders it. */
export interface BoardEntry {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  slug: string | null;
  /** Drives the Sleeper CDN headshot. Null when the player has no Sleeper id. */
  sleeperId: string | null;
  /** nfl_teams.primary_color, for the card's team accent. Null when unknown. */
  teamColor: string | null;
  /** Full team name, so the card is not only an abbreviation. */
  teamName: string | null;
  marketAdp: number | null;
  beaconPick: number | null;
  valueGap: number | null;
  stealScore: number | null;
  confidence: number | null;
  beatRate: number | null;
  pointsAboveReplacement: number | null;
  category: StealCategory;
  verdict: string;
}

export interface BoardBuckets {
  steals: BoardEntry[];
  swings: BoardEntry[];
  fades: BoardEntry[];
  /** When the board was last rebuilt. Null when the format has no board. */
  computedAt: string | null;
  /** Which market the ADP came from, for the attribution line. */
  marketAdpKey: string | null;
  marketSource: string | null;
  season: number | null;
}

const EMPTY: BoardBuckets = {
  steals: [],
  swings: [],
  fades: [],
  computedAt: null,
  marketAdpKey: null,
  marketSource: null,
  season: null,
};

interface JoinedRow {
  player_id: string;
  position: string | null;
  market_adp: number | null;
  market_adp_key: string | null;
  market_source: string | null;
  beacon_pick: number | null;
  value_gap: number | null;
  steal_score: number | null;
  confidence: number | null;
  beat_rate: number | null;
  points_above_replacement: number | null;
  category: string;
  verdict: string;
  computed_at: string;
  season: number;
  players: {
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
    slug: string | null;
    external_ids: Record<string, unknown> | null;
  };
}

/** The Sleeper id lives on the players.external_ids json map, not a column. */
function readSleeperId(externalIds: Record<string, unknown> | null): string | null {
  const value = externalIds?.sleeper;
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function toEntry(
  row: JoinedRow,
  teams: ReadonlyMap<string, { name: string; color: string | null }>,
): BoardEntry {
  const team = row.players.team;
  const teamRow = team ? teams.get(team) : undefined;
  return {
    playerId: row.player_id,
    name: `${row.players.first_name} ${row.players.last_name}`.trim(),
    position: row.position ?? row.players.position,
    team,
    slug: row.players.slug,
    sleeperId: readSleeperId(row.players.external_ids),
    teamColor: teamRow?.color ?? null,
    teamName: teamRow?.name ?? null,
    marketAdp: row.market_adp === null ? null : Number(row.market_adp),
    beaconPick: row.beacon_pick === null ? null : Number(row.beacon_pick),
    valueGap: row.value_gap === null ? null : Number(row.value_gap),
    stealScore: row.steal_score === null ? null : Number(row.steal_score),
    confidence: row.confidence === null ? null : Number(row.confidence),
    beatRate: row.beat_rate === null ? null : Number(row.beat_rate),
    pointsAboveReplacement:
      row.points_above_replacement === null ? null : Number(row.points_above_replacement),
    category: row.category as StealCategory,
    verdict: row.verdict,
  };
}

/**
 * The three published buckets for one format, each capped.
 *
 * Ordered by steal_score, which already folds confidence in, so the cap never
 * cuts off a well-evidenced player in favour of a noisier one. Fades are ordered
 * ascending because a fade's severity runs the other way.
 */
export async function loadBoardBuckets(
  supabase: Client,
  params: { formatSlug: string; season: number; limit?: number },
): Promise<BoardBuckets> {
  const limit = params.limit ?? 12;
  const select =
    "player_id, position, market_adp, market_adp_key, market_source, beacon_pick, value_gap, position_adjusted_gap, steal_score, confidence, beat_rate, points_above_replacement, category, verdict, computed_at, season, players!inner(first_name, last_name, position, team, slug, external_ids)";

  // SEASON IS PART OF THE KEY AND IT WAS MISSING. The primary key is
  // (format_slug, season, player_id) and the build's stale prune is scoped to
  // the season it just built, so last season's rows survive on purpose. Reading
  // on format alone works today because only 2026 exists, and would silently
  // interleave two seasons of rows in the same top-12 list next August. It also
  // left idx_draft_value_targets_board (format_slug, season, category,
  // steal_score desc) unable to use its trailing columns.
  //
  // The secondary sort keys matter too: steal_score is an INTEGER and heavily
  // tied (83 steals over 32 distinct scores in dynasty superflex, with ties
  // falling inside the top-12 window), and Postgres gives no stable order for
  // equal keys. Without a tiebreak the published list, and anything cached from
  // it, reshuffled between page loads with no data change.
  const bucket = (category: string, ascending: boolean) =>
    supabase
      .from("draft_value_targets")
      .select(select)
      .eq("format_slug", params.formatSlug)
      .eq("season", params.season)
      .eq("category", category)
      .order("steal_score", { ascending })
      .order("position_adjusted_gap", { ascending })
      .order("player_id", { ascending: true })
      .limit(limit);

  const [stealRes, swingRes, fadeRes] = await Promise.all([
    bucket("steal", false),
    bucket("swing", false),
    // A fade's severity runs the other way, so the worst offender leads.
    bucket("fade", true),
  ]);

  const stealRows = (stealRes.data ?? []) as unknown as JoinedRow[];
  const swingRows = (swingRes.data ?? []) as unknown as JoinedRow[];
  const fadeRows = (fadeRes.data ?? []) as unknown as JoinedRow[];

  const first = stealRows[0] ?? swingRows[0] ?? fadeRows[0];
  if (!first) return EMPTY;

  // Team names and brand colors for the cards, in one query for the whole page
  // rather than a join per bucket. nfl_teams is 32 rows.
  const abbrs = [...new Set(
    [...stealRows, ...swingRows, ...fadeRows]
      .map((r) => r.players.team)
      .filter((t): t is string => Boolean(t)),
  )];
  const teams = new Map<string, { name: string; color: string | null }>();
  if (abbrs.length > 0) {
    const { data: teamRows } = await supabase
      .from("nfl_teams")
      .select("abbreviation, name, primary_color")
      .in("abbreviation", abbrs);
    for (const t of teamRows ?? []) {
      teams.set(t.abbreviation, { name: t.name, color: t.primary_color });
    }
  }

  const steals = stealRows.map((r) => toEntry(r, teams));
  const swings = swingRows.map((r) => toEntry(r, teams));
  const fades = fadeRows.map((r) => toEntry(r, teams));

  return {
    steals,
    swings,
    fades,
    computedAt: first.computed_at,
    marketAdpKey: first.market_adp_key,
    marketSource: first.market_source,
    season: first.season,
  };
}

/**
 * Every format that currently has a published board, in display order, plus the
 * newest season any board covers.
 *
 * Reads the draft_value_board_formats VIEW (migration 0193), which is a
 * `select distinct`, rather than pulling every row of draft_value_targets to
 * build a set of eight strings.
 *
 * The first version did the latter with `.limit(5000)`, and that was wrong twice
 * over. PostgREST enforces its own max-rows ceiling of 1000 regardless of what
 * `.limit()` asks for, so it was already only seeing the first thousand rows;
 * and it had no `.order()`, so which thousand was arbitrary. A format with a
 * real board could silently vanish from the switcher.
 */
export async function loadFormatsWithBoards(
  supabase: Client,
): Promise<{ formats: { slug: string; display: string }[]; season: number | null }> {
  const { data: present } = await supabase
    .from("draft_value_board_formats")
    .select("format_slug, season")
    .order("season", { ascending: false });

  // A view's columns are all nullable to PostgREST, so both are narrowed here.
  const rows = (present ?? []).flatMap((r) =>
    typeof r.season === "number" && typeof r.format_slug === "string"
      ? [{ season: r.season, format_slug: r.format_slug }]
      : [],
  );
  if (rows.length === 0) return { formats: [], season: null };

  // The board describes one season at a time. When a rollover leaves two in the
  // table, the newest is the one to show.
  const season = rows.reduce((max, r) => Math.max(max, r.season), rows[0].season);
  const slugs = new Set(rows.filter((r) => r.season === season).map((r) => r.format_slug));

  const { data: formats } = await supabase
    .from("format_configs")
    .select("slug, display_name, display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  return {
    formats: (formats ?? [])
      .filter((f) => slugs.has(f.slug))
      .map((f) => ({ slug: f.slug, display: f.display_name })),
    season,
  };
}

/** Plain-language name for the market an ADP came from. */
export function marketLabel(source: string | null, key: string | null): string {
  const platform = source === "dynastyprocess" ? "FantasyPros rookie rankings" : "Sleeper";
  if (!key) return platform;
  const KEYS: Record<string, string> = {
    ppr: "PPR",
    half_ppr: "half PPR",
    std: "standard",
    "2qb": "superflex",
    dynasty_ppr: "dynasty PPR",
    dynasty_half_ppr: "dynasty half PPR",
    dynasty_std: "dynasty standard",
    dynasty_2qb: "dynasty superflex",
    rookie: "rookie draft",
  };
  const market = KEYS[key];
  return market ? `${platform} ${market} ADP` : `${platform} ADP`;
}
