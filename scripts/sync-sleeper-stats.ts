/**
 * Sleeper weekly stats import for a given season.
 *
 * Usage: SEASON=2024 npm run sync:stats
 */

import { getServiceClient } from "./_supabase";

type SleeperStatRow = {
  player_id?: string;
  stats?: Record<string, number>;
  pts_std?: number;
  pts_half_ppr?: number;
  pts_ppr?: number;
};

const SEASON = Number.parseInt(process.env.SEASON ?? "2024", 10);
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

async function fetchWeek(week: number): Promise<unknown[]> {
  const url = `https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${week}`;
  const response = await fetch(url, {
    headers: { "user-agent": "ffbeacon-sync/1.0" },
  });
  if (!response.ok) {
    console.warn(`  week ${week}: HTTP ${response.status}`);
    return [];
  }
  const raw = await response.json();
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([player_id, payload]) => ({
      player_id,
      ...(payload as Record<string, unknown>),
    }));
  }
  return [];
}

async function main() {
  const supabase = getServiceClient();

  console.log("Loading player map...");
  const { data: players, error: pErr } = await supabase
    .from("players")
    .select("id, external_ids");
  if (pErr) throw pErr;
  const idBySleeper = new Map<string, string>();
  for (const p of players ?? []) {
    const sleeperId = (p.external_ids as { sleeper?: string } | null)?.sleeper;
    if (sleeperId) idBySleeper.set(sleeperId, p.id);
  }
  console.log(`${idBySleeper.size} players have Sleeper IDs`);

  const now = new Date().toISOString();

  for (const week of WEEKS) {
    console.log(`Fetching season ${SEASON} week ${week}...`);
    const rows = await fetchWeek(week);
    const upserts: Array<Record<string, unknown>> = [];

    for (const row of rows as SleeperStatRow[]) {
      if (!row.player_id) continue;
      const playerId = idBySleeper.get(row.player_id);
      if (!playerId) continue;
      const stats = row.stats ?? {};
      upserts.push({
        player_id: playerId,
        week,
        season: SEASON,
        season_type: "regular",
        metadata: row as unknown as Record<string, unknown>,
        pass_yd: readNumber(stats.pass_yd),
        pass_td: readNumber(stats.pass_td),
        pass_int: readNumber(stats.pass_int),
        pass_2pt: readNumber(stats.pass_2pt),
        rush_yd: readNumber(stats.rush_yd),
        rush_td: readNumber(stats.rush_td),
        rush_2pt: readNumber(stats.rush_2pt),
        rec: readNumber(stats.rec),
        rec_yd: readNumber(stats.rec_yd),
        rec_td: readNumber(stats.rec_td),
        rec_2pt: readNumber(stats.rec_2pt),
        fum_lost: readNumber(stats.fum_lost),
        pts_standard: readNumber(stats.pts_std ?? row.pts_std),
        pts_half_ppr: readNumber(stats.pts_half_ppr ?? row.pts_half_ppr),
        pts_ppr: readNumber(stats.pts_ppr ?? row.pts_ppr),
        snap_count: typeof stats.off_snp === "number" ? stats.off_snp : null,
        targets: typeof stats.rec_tgt === "number" ? stats.rec_tgt : null,
        carries: typeof stats.rush_att === "number" ? stats.rush_att : null,
        updated_at: now,
      });
    }

    if (upserts.length === 0) continue;

    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const { error } = await supabase
        .from("player_stats")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(chunk as any, {
          onConflict: "player_id,week,season,season_type",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error("Upsert error:", error.message);
        throw error;
      }
    }
    console.log(`  week ${week}: upserted ${upserts.length} rows`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
