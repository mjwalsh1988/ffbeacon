import { getServiceClient } from "./_supabase";

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

  const valueResult = await supabase
    .from("player_value_history")
    .select("player_id, value, captured_at")
    .eq("format_config_id", format.id)
    .eq("source", "ktc")
    .in("player_id", playerIds)
    .order("captured_at", { ascending: false });
  console.log("player_value_history rows:", valueResult.data?.length, "error:", valueResult.error?.message);
  console.log("first 3:", valueResult.data?.slice(0, 3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
