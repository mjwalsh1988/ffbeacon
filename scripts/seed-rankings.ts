/**
 * Build KTC-derived rankings from the latest KTC player_value_history snapshot
 * per format.
 *
 * For each format_config, take the latest value per player (source='ktc'),
 * order by value desc, derive overall_rank, position_rank, and 6-tier bucketing.
 *
 * These rankings inherit their provenance from KTC values, so they are tagged
 * source='ktc'. The source='ffbeacon' label is reserved for rankings produced
 * by FF Beacon's own original logic (editorial overlay, model blends). See
 * /docs/data-sources.md for the full source taxonomy.
 *
 * Run: npm run seed:rankings
 */

import { getServiceClient } from "./_supabase";

const SEASON = 2025;
const TIERS = 6;

async function main() {
  const supabase = getServiceClient();

  const { data: formats, error: fErr } = await supabase
    .from("format_configs")
    .select("id, slug");
  if (fErr) throw fErr;

  for (const format of formats ?? []) {
    console.log(`Seeding rankings for ${format.slug}...`);
    const { data: values, error: vErr } = await supabase
      .from("player_value_history")
      .select("player_id, value, captured_at, players(position)")
      .eq("format_config_id", format.id)
      .eq("source", "ktc")
      .order("captured_at", { ascending: false });
    if (vErr) {
      console.warn(`  ${vErr.message}`);
      continue;
    }
    if (!values || values.length === 0) {
      console.log(`  no KTC values yet`);
      continue;
    }

    // Pick latest captured value per player
    const latestByPlayer = new Map<string, { value: number; position: string }>();
    for (const row of values) {
      if (latestByPlayer.has(row.player_id)) continue;
      const position =
        ((row as unknown as { players: { position: string } | null }).players?.position) ?? "WR";
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
        format_config_id: format.id,
        overall_rank: index + 1,
        position_rank: positionalCounts[row.position],
        tier,
        source: "ktc",
        week: null,
        season: SEASON,
        // Provenance: these rankings are derived from KTC player_value_history.
        // The original KTC payload lives on the source row, not here.
        metadata: {
          derived_from: { table: "player_value_history", source_slug: "ktc" },
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
