import { getServiceClient } from "./_supabase";
import { fetchAllRowsInChunks } from "../lib/supabase/fetch-all";

async function main() {
  const supabase = getServiceClient();

  const { data: format } = await supabase
    .from("format_configs")
    .select("id, slug")
    .eq("slug", "dynasty-ppr-std")
    .maybeSingle();

  if (!format) throw new Error("no format");
  console.log("format:", format);

  const rankingsResult = await supabase
    .from("rankings")
    .select("overall_rank, position_rank, tier, players!inner(id, slug, first_name, last_name, position, team, status)")
    .eq("format_config_id", format.id)
    .eq("source", "ktc")
    .eq("season", 2025)
    .is("week", null)
    .order("overall_rank")
    .limit(500);
  console.log("rankings rows:", rankingsResult.data?.length, "error:", rankingsResult.error?.message);

  const playerIds = (rankingsResult.data ?? []).map(
    (r) => (r as unknown as { players: { id: string } }).players.id,
  );
  console.log("player_ids:", playerIds.length);

  // Chunked and paged: 500 ids overflow one request URL, and their history is
  // far more than 1000 rows. Chunks are merged, so re-sort newest first.
  const values = await fetchAllRowsInChunks("player_value_history", playerIds, (chunk, from, to) =>
    supabase
      .from("player_value_history")
      .select("player_id, value, captured_at")
      .eq("format_config_id", format.id)
      .eq("source", "ktc")
      .in("player_id", chunk)
      .order("captured_at", { ascending: false })
      .order("player_id", { ascending: true })
      .range(from, to),
  );
  values.sort((a, b) => b.captured_at.localeCompare(a.captured_at) || a.player_id.localeCompare(b.player_id));
  console.log("player_value_history rows:", values.length);
  console.log("first 3:", values.slice(0, 3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
