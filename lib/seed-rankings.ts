/**
 * Build source-attributed rankings (library form).
 * See scripts/seed-rankings.ts header for the full algorithm description.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { withRetry } from "./supabase/retry";
import { currentNflSeason } from "./sleeper";
import { fetchAllRows } from "./supabase/fetch-all";

/**
 * The season these rankings describe.
 *
 * Derived, never typed in. It used to be `const SEASON = 2025` written out by
 * hand in THREE files: here, components/rankings/rankings-view.tsx and
 * app/api/rankings/import/route.ts. On 2026-08-25 all three still said 2025
 * while the site was operating in the 2026 season, and it worked only because
 * writer and readers happened to agree on the same wrong number.
 *
 * The trap was that they could stop agreeing. Bumping the writer and missing a
 * reader would leave that reader querying a season nothing writes any more, and
 * it would serve the frozen old rows forever without erroring, which is the
 * exact silent-staleness shape this whole change set is about.
 *
 * The readers no longer filter on season at all, because the sweep at the end
 * of runSeedRankings guarantees the table holds exactly one season. That also
 * removes a rollover gap: currentNflSeason() flips in March, and a reader
 * pinned to the new season would have shown an empty board until the next
 * nightly write.
 */
export function rankingsSeason(): number {
  return Number(currentNflSeason());
}

const TIERS = 6;

/**
 * How far back from a source's newest captured_at still counts as the same
 * capture. Every sync stamps one timestamp per run and runs at most daily, so
 * this takes the newest run whole and nothing from the one before it.
 */
const CAPTURE_WINDOW_MS = 6 * 60 * 60 * 1000;

type HistoryRow = {
  player_id: string;
  value: number;
  captured_at: string;
  players: { position: string } | null;
};

/**
 * The rows of a (source, format)'s newest capture, newest first.
 *
 * This used to read the whole history newest first with no paging, so it saw
 * the newest 1000 rows: the latest capture plus whatever part of the previous
 * one fit under the cap. Anchoring on the newest captured_at and paging that
 * window makes the board the source's latest capture, at any size.
 */
async function loadLatestCapture(
  supabase: SupabaseClient<Database>,
  sourceSlug: string,
  formatId: string,
): Promise<HistoryRow[]> {
  const { data: newest, error } = await supabase
    .from("player_value_history")
    .select("captured_at")
    .eq("format_config_id", formatId)
    .eq("source", sourceSlug)
    .order("captured_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const newestAt = newest?.[0]?.captured_at;
  if (!newestAt) return [];
  const windowStart = new Date(new Date(newestAt).getTime() - CAPTURE_WINDOW_MS).toISOString();
  const rows = await fetchAllRows(`seed rankings ${sourceSlug}/${formatId}`, (from, to) =>
    supabase
      .from("player_value_history")
      .select("player_id, value, captured_at, players(position)")
      .eq("format_config_id", formatId)
      .eq("source", sourceSlug)
      .gte("captured_at", windowStart)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows as unknown as HistoryRow[];
}

type SourceRow = {
  slug: string;
  data_type: string[];
  supported_format_slugs: string[] | null;
};

export type SeedRankingsResult = {
  ok: boolean;
  /** The season every row now carries. Derived, never typed in. */
  season: number;
  /** Rows deleted because they belonged to a season nothing writes any more. */
  previousSeasonRowsRemoved: number;
  totalRows: number;
  perCombo: Array<{ source: string; formatSlug: string; rows: number }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runSeedRankings(
  supabase: SupabaseClient<Database>,
): Promise<SeedRankingsResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  // Stamped on every row this run writes, new or existing. See the comment on
  // the row builder below for why this cannot be left to the column default.
  const generatedAt = startedAt;
  const season = rankingsSeason();

  const { data: formats, error: fErr } = await supabase
    .from("format_configs")
    .select("id, slug");
  if (fErr) throw fErr;
  const formatBySlug = new Map<string, string>((formats ?? []).map((f) => [f.slug, f.id]));

  // NOTE: we intentionally do NOT filter by is_active here. rankings is a
  // derived cache; public visibility is gated downstream by
  // resolveSourceForFormat (which filters source_registry on is_active), so
  // seeding an inactive source's rankings is never read by the public UI.
  // Seeding all sources keeps the cache pre-staged, so flipping is_active is the
  // ONLY step that exposes a source publicly (its rankings already exist). This
  // matters for ffbeacon, which launches at priority 1 with is_active=false.
  const { data: sources, error: sErr } = await supabase
    .from("source_registry")
    .select("slug, data_type, supported_format_slugs")
    .order("priority");
  if (sErr) throw sErr;

  const valueSources = (sources ?? []).filter(
    (s) =>
      Array.isArray(s.data_type) && s.data_type.includes("player_value_history"),
  ) as SourceRow[];

  let totalRows = 0;
  const perCombo: SeedRankingsResult["perCombo"] = [];

  for (const source of valueSources) {
    const targetSlugs =
      source.supported_format_slugs && source.supported_format_slugs.length > 0
        ? source.supported_format_slugs
        : Array.from(formatBySlug.keys());

    for (const slug of targetSlugs) {
      const formatId = formatBySlug.get(slug);
      if (!formatId) {
        console.warn(`  [${source.slug}] ${slug}: no format_config found, skipping`);
        continue;
      }
      console.log(`Seeding rankings for ${source.slug} / ${slug}...`);
      // withRetry: a transient PostgREST statement_timeout must not silently drop
      // an entire (source, format) from rankings. Retry transient failures, and
      // let a persistent error throw so the run fails loudly instead of shipping
      // a format with no rankings.
      const values = await withRetry(
        () => loadLatestCapture(supabase, source.slug, formatId),
        { label: `seed rankings ${source.slug}/${slug}` },
      );
      if (values.length === 0) {
        console.log(`  no ${source.slug} values yet`);
        continue;
      }

      const latestByPlayer = new Map<string, { value: number; position: string }>();
      for (const row of values) {
        if (latestByPlayer.has(row.player_id)) continue;
        const position = row.players?.position ?? "WR";
        latestByPlayer.set(row.player_id, { value: row.value, position });
      }

      // Value descending, then player_id as a deterministic tie-break.
      //
      // Without the second key, players sharing a value fall back to whatever
      // order Postgres happened to return, which is not stable between runs. Any
      // run of equal values would then re-shuffle nightly, and every player in it
      // would show invented rank movement in player_value_trends. Ties are common
      // at the bottom of a board where many players are worth almost nothing, and
      // calibrated normalization makes them longer still, so the tie-break is what
      // keeps a flat run flat instead of churning.
      const sorted = Array.from(latestByPlayer.entries())
        .map(([player_id, payload]) => ({ player_id, ...payload }))
        .sort((a, b) => b.value - a.value || a.player_id.localeCompare(b.player_id));

      const positionalCounts: Record<string, number> = {};
      const rankings = sorted.map((row, index) => {
        positionalCounts[row.position] = (positionalCounts[row.position] ?? 0) + 1;
        const tier = Math.min(
          TIERS,
          Math.max(1, Math.ceil(((index + 1) / sorted.length) * TIERS)),
        );
        return {
          player_id: row.player_id,
          format_config_id: formatId,
          overall_rank: index + 1,
          position_rank: positionalCounts[row.position],
          tier,
          source: source.slug,
          week: null,
          season,
          // ALWAYS set this explicitly. rankings.generated_at has a now()
          // default, and a default fires only on INSERT: this upsert conflicts
          // on (player_id, format_config_id, source, week, season) and so
          // UPDATES an existing row every night, leaving the default untouched.
          // The column therefore recorded when a player was FIRST ever ranked,
          // not when we last ranked them, which is the opposite of what every
          // reader assumes.
          //
          // Three of them filter on it as a 90-day relevance window:
          // lib/player-search.ts (every search box on the site),
          // lib/signal-scout/eligibility.ts (the daily game's player pool), and
          // lib/beacon-brief-feed.ts. Because the timestamp never moved, ranked
          // players aged out of all three while being ranked every single night.
          // Measured on 2026-08-25: 2 players had already gone, 158 would go by
          // 30 September, 712 by 31 October and all 815 by 30 November, with
          // nothing erroring at any point.
          generated_at: generatedAt,
          metadata: {
            derived_from: {
              table: "player_value_history",
              source_slug: source.slug,
            },
            input_value: row.value,
          },
        };
      });

      for (let i = 0; i < rankings.length; i += 200) {
        const chunk = rankings.slice(i, i + 200);
        const { error } = await supabase
          .from("rankings")
          .upsert(chunk, {
            onConflict: "player_id,format_config_id,source,week,season",
            ignoreDuplicates: false,
          });
        if (error) throw error;
      }
      // A player the source no longer carries keeps his old row otherwise: the
      // upsert only touches players in this run. That row holds an old
      // overall_rank that now collides with a current player's (measured
      // 2026-09-24: 817 ffbeacon dynasty rows over 595 players, 709 distinct
      // ranks). Every row this run wrote carries generatedAt, so anything older
      // in this (source, format, season) is a player who dropped out.
      const { data: dropped, error: dropErr } = await withRetry(
        async () =>
          await supabase
            .from("rankings")
            .delete()
            .eq("source", source.slug)
            .eq("format_config_id", formatId)
            .eq("season", season)
            .is("week", null)
            .lt("generated_at", generatedAt)
            .select("id"),
        { label: `rankings clear-dropped ${source.slug}/${slug}` },
      );
      if (dropErr) throw dropErr;
      if ((dropped?.length ?? 0) > 0) {
        console.log(`  removed ${dropped!.length} rows for players no longer in the source`);
      }
      console.log(`  ${rankings.length} ranking rows`);
      totalRows += rankings.length;
      perCombo.push({ source: source.slug, formatSlug: slug, rows: rankings.length });
    }
  }

  // The table holds exactly one season, so no reader has to know which one.
  // Anything under a different season is an orphan from before a rollover, and
  // leaving it would keep counting toward the 90-day relevance window that
  // lib/player-search.ts, lib/signal-scout/eligibility.ts and
  // lib/beacon-brief-feed.ts all read, long after nothing writes it any more.
  //
  // Guarded on having written something, so a run that failed early cannot
  // empty the table on the strength of that failure.
  let previousSeasonRowsRemoved = 0;
  if (totalRows > 0) {
    const { data: removed, error: clearErr } = await withRetry(
      async () => await supabase.from("rankings").delete().neq("season", season).select("id"),
      { label: "rankings clear-other-seasons" },
    );
    if (clearErr) throw clearErr;
    previousSeasonRowsRemoved = removed?.length ?? 0;
    if (previousSeasonRowsRemoved > 0) {
      console.log(`  removed ${previousSeasonRowsRemoved} rows from a previous season`);
    }
  }

  const finished = Date.now();
  console.log(`\nDone. ${totalRows} ranking rows across all (source, format) pairs.`);
  return {
    ok: true,
    season,
    totalRows,
    previousSeasonRowsRemoved,
    perCombo,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
