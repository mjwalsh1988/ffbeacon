/**
 * Sleeper player sync.
 *
 * Pulls all NFL players from https://api.sleeper.app/v1/players/nfl,
 * filters to fantasy-relevant positions, and upserts into players.
 *
 * Run: npm run sync:players
 */

import { getServiceClient, slugify, chunkUpsert } from "./_supabase";

type SleeperPlayer = {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string | null;
  status?: string;
  active?: boolean;
  birth_date?: string;
  height?: string;
  weight?: string;
  college?: string;
  years_exp?: number;
};

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function parseHeight(value: string | undefined): number | null {
  if (!value) return null;
  // Sleeper height is sometimes "6'2" or "74" (inches)
  if (value.includes("'")) {
    const [feet, inches] = value.split("'");
    const f = Number.parseInt(feet, 10);
    const i = Number.parseInt(inches?.replace(/[^0-9]/g, "") ?? "0", 10);
    if (Number.isFinite(f) && Number.isFinite(i)) return f * 12 + i;
    return null;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseWeight(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const supabase = getServiceClient();

  console.log("Fetching Sleeper players...");
  const response = await fetch("https://api.sleeper.app/v1/players/nfl", {
    headers: { "user-agent": "ffbeacon-sync/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Sleeper API responded ${response.status}`);
  }
  const playersByteSleeperId = (await response.json()) as Record<string, SleeperPlayer>;
  console.log(`Got ${Object.keys(playersByteSleeperId).length} total players`);

  const now = new Date().toISOString();
  const rows = Object.entries(playersByteSleeperId)
    .filter(([sleeperId, player]) => {
      if (!sleeperId) return false;
      const positions = new Set([
        player.position,
        ...(player.fantasy_positions ?? []),
      ].filter(Boolean) as string[]);
      const hasFantasyPosition = [...positions].some((p) => FANTASY_POSITIONS.has(p));
      if (!hasFantasyPosition) return false;
      if (!player.first_name && !player.last_name && !player.full_name) return false;
      return true;
    })
    .map(([sleeperId, player]) => {
      const first = player.first_name ?? player.full_name?.split(" ")[0] ?? "";
      const last =
        player.last_name ?? player.full_name?.split(" ").slice(1).join(" ") ?? "";
      const primaryPosition =
        player.position && FANTASY_POSITIONS.has(player.position)
          ? player.position
          : (player.fantasy_positions ?? []).find((p) => FANTASY_POSITIONS.has(p)) ?? "WR";
      const baseName = `${first}-${last}`.trim();
      const slug = slugify(baseName ? `${baseName}-${sleeperId}` : sleeperId);
      return {
        slug,
        external_ids: { sleeper: sleeperId },
        first_name: first || "Unknown",
        last_name: last || sleeperId,
        position: primaryPosition,
        team: player.team ?? null,
        status:
          player.active === false
            ? "inactive"
            : player.status?.toLowerCase().includes("ir")
              ? "ir"
              : "active",
        birth_date: player.birth_date ?? null,
        height_inches: parseHeight(player.height),
        weight_lbs: parseWeight(player.weight),
        college: player.college ?? null,
        years_experience: typeof player.years_exp === "number" ? player.years_exp : null,
        metadata: { sleeper: player as unknown as Record<string, unknown> },
        source_synced_at: { sleeper: now },
        updated_at: now,
      };
    });

  // metadata / source_synced_at are jsonb maps keyed by source slug. The
  // upsert below replaces the cell wholesale, so we must merge with any
  // existing per-source keys from other sources (e.g. KTC) before writing.
  // One bulk SELECT per page keeps this fast.
  console.log("Loading existing metadata for merge...");
  const existingBySlug = new Map<
    string,
    { metadata: Record<string, unknown>; source_synced_at: Record<string, unknown> }
  >();
  const targetSlugs = rows.map((r) => r.slug);
  for (let from = 0; from < targetSlugs.length; from += 1000) {
    const batch = targetSlugs.slice(from, from + 1000);
    const { data, error } = await supabase
      .from("players")
      .select("slug, metadata, source_synced_at")
      .in("slug", batch);
    if (error) throw error;
    for (const p of data ?? []) {
      existingBySlug.set(p.slug, {
        metadata: (p.metadata as Record<string, unknown>) ?? {},
        source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
      });
    }
  }

  const mergedRows = rows.map((row) => {
    const prev = existingBySlug.get(row.slug);
    if (!prev) return row;
    return {
      ...row,
      metadata: { ...prev.metadata, ...row.metadata },
      source_synced_at: { ...prev.source_synced_at, ...row.source_synced_at },
    };
  });

  console.log(`Upserting ${mergedRows.length} fantasy-relevant players`);

  let upserted = 0;
  await chunkUpsert(mergedRows, 300, async (chunk) => {
    const { error } = await supabase
      .from("players")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(chunk as any, { onConflict: "slug", ignoreDuplicates: false });
    if (error) {
      console.error("Upsert error:", error.message);
      throw error;
    }
    upserted += chunk.length;
    process.stdout.write(`  ${upserted}/${mergedRows.length}\r`);
  });

  console.log(`\nDone. Upserted ${upserted} players.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
