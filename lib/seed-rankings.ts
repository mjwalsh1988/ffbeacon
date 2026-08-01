/**
 * Build source-attributed rankings (library form).
 * See scripts/seed-rankings.ts header for the full algorithm description.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { withRetry } from "./supabase/retry";

const SEASON = 2025;
const TIERS = 6;

type SourceRow = {
  slug: string;
  data_type: string[];
  supported_format_slugs: string[] | null;
};

export type SeedRankingsResult = {
  ok: boolean;
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
        async () => {
          const { data, error } = await supabase
            .from("player_value_history")
            .select("player_id, value, captured_at, players(position)")
            .eq("format_config_id", formatId)
            .eq("source", source.slug)
            .order("captured_at", { ascending: false });
          if (error) throw error;
          return data ?? [];
        },
        { label: `seed rankings ${source.slug}/${slug}` },
      );
      if (values.length === 0) {
        console.log(`  no ${source.slug} values yet`);
        continue;
      }

      const latestByPlayer = new Map<string, { value: number; position: string }>();
      for (const row of values) {
        if (latestByPlayer.has(row.player_id)) continue;
        const position =
          ((row as unknown as { players: { position: string } | null }).players
            ?.position) ?? "WR";
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
          season: SEASON,
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
      console.log(`  ${rankings.length} ranking rows`);
      totalRows += rankings.length;
      perCombo.push({ source: source.slug, formatSlug: slug, rows: rankings.length });
    }
  }

  const finished = Date.now();
  console.log(`\nDone. ${totalRows} ranking rows across all (source, format) pairs.`);
  return {
    ok: true,
    totalRows,
    perCombo,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
