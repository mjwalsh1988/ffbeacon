/**
 * Build source-attributed rankings from the latest player_value_history
 * snapshot per (source, format).
 *
 * For every active row in source_registry, walk its supported_format_slugs.
 * For each (source, format) pair:
 *   - Pull the latest player_value_history rows tagged with that source
 *     for that format.
 *   - Sort by value desc.
 *   - Derive overall_rank, position_rank, and a 6-tier bucket from the order.
 *   - Upsert into rankings tagged with the same source slug.
 *
 * These rankings are a deterministic restatement of the source's own value
 * ordering, so they inherit their provenance — `rankings.source = '<source>'`,
 * not `'ffbeacon'`. The `ffbeacon` slug stays reserved for original FF Beacon
 * pipelines (editorial overlays, model blends).
 *
 * The rankings table uses UNIQUE NULLS NOT DISTINCT (player_id,
 * format_config_id, source, week, season) (migration 0015), so an upsert with
 * week=NULL is idempotent — rerunning this script updates the snapshot in
 * place instead of doubling row counts.
 *
 * Run: npm run seed:rankings
 */

import { getServiceClient } from "./_supabase";

const SEASON = 2025;
const TIERS = 6;

type SourceRow = {
  slug: string;
  data_type: string[];
  supported_format_slugs: string[] | null;
};

async function main() {
  const supabase = getServiceClient();

  const { data: formats, error: fErr } = await supabase
    .from("format_configs")
    .select("id, slug");
  if (fErr) throw fErr;
  const formatBySlug = new Map<string, string>((formats ?? []).map((f) => [f.slug, f.id]));

  const { data: sources, error: sErr } = await supabase
    .from("source_registry")
    .select("slug, data_type, supported_format_slugs")
    .eq("is_active", true)
    .order("priority");
  if (sErr) throw sErr;

  // Filter to sources that publish into rankings/player_value_history. The
  // data_type check guards against future operational-only sources that don't
  // produce rankings.
  const valueSources = (sources ?? []).filter(
    (s) =>
      Array.isArray(s.data_type) && s.data_type.includes("player_value_history"),
  ) as SourceRow[];

  let totalRows = 0;
  for (const source of valueSources) {
    // null supported_format_slugs => supports every active format. We fall
    // through to formatBySlug.keys() in that case.
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
      const { data: values, error: vErr } = await supabase
        .from("player_value_history")
        .select("player_id, value, captured_at, players(position)")
        .eq("format_config_id", formatId)
        .eq("source", source.slug)
        .order("captured_at", { ascending: false });
      if (vErr) {
        console.warn(`  ${vErr.message}`);
        continue;
      }
      if (!values || values.length === 0) {
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

      const sorted = Array.from(latestByPlayer.entries())
        .map(([player_id, payload]) => ({ player_id, ...payload }))
        .sort((a, b) => b.value - a.value);

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
        if (error) {
          console.error("Upsert error:", error.message);
          throw error;
        }
      }
      console.log(`  ${rankings.length} ranking rows`);
      totalRows += rankings.length;
    }
  }

  console.log(`\nDone. ${totalRows} ranking rows across all (source, format) pairs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
