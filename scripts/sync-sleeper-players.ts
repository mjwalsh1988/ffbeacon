/**
 * Sleeper player sync.
 *
 * Pulls all NFL players from https://api.sleeper.app/v1/players/nfl and
 * upserts every player Sleeper considers in-scope for fantasy/IDP rosters
 * into our players table.
 *
 * Inclusion policy (broad, not narrow):
 *   - Must have a name.
 *   - Must have a `position` string (NFL position label).
 *   - Skip rows where active=false AND no team, those are clearly retired
 *     players with no current affiliation; keeping them only inflates the
 *     table without any fantasy-data path that would reach them.
 *   - DO include IDP positions (LB, CB, DB, DL, DE, DT, S), offensive line
 *     (OL, OT, OG, C, G, T), kickers, defenses, etc. Many real Sleeper
 *     rosters carry IDPs; the prior QB/RB/WR/TE/K/DEF allow-list was
 *     dropping ~4000 valid players who could appear on a roster.
 *   - DO include practice squad, IR, suspended (status reflects this).
 *
 * Position normalization:
 *   - Primary `players.position` is the first fantasy_positions entry that
 *     matches our known set; falls back to player.position when there's no
 *     fantasy_positions value.
 *
 * External ID merge:
 *   - external_ids is a multi-source jsonb map. Sleeper sync ONLY writes the
 *     "sleeper" key, it must NEVER strip "ktc" / "fantasycalc" / etc that
 *     other syncs landed. The merge below reads existing rows and folds the
 *     sleeper key into whatever was already there.
 *
 * Slug stability:
 *   - Slug encodes the sleeper id (e.g. "patrick-mahomes-4046"). Once a row
 *     exists for a sleeper id, we keep its slug, so downstream lookups by
 *     slug-tail (sync-fantasycalc.ts, lib/league-power-rankings.ts) stay
 *     stable even if a player's name changes.
 *
 * Run: npm run sync:players
 */

import { getServiceClient, slugify, withRetry } from "./_supabase";

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

// Positions we recognize for the players.position column. Anything outside
// this set is preserved verbatim from Sleeper (so an "OL" stays "OL"); this
// list is just the priority order when fantasy_positions has multiple
// entries.
const KNOWN_POSITIONS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
  "DL",
  "DE",
  "DT",
  "NT",
  "LB",
  "ILB",
  "OLB",
  "DB",
  "CB",
  "S",
  "FS",
  "SS",
  "OL",
  "OT",
  "OG",
  "C",
  "G",
  "T",
  "FB",
  "P",
  "LS",
];

const KNOWN_POSITION_SET = new Set(KNOWN_POSITIONS);

function parseHeight(value: string | undefined): number | null {
  if (!value) return null;
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

function pickPrimaryPosition(player: SleeperPlayer): string | null {
  const candidates: string[] = [];
  if (Array.isArray(player.fantasy_positions)) {
    for (const p of player.fantasy_positions) {
      if (typeof p === "string" && p.length > 0) candidates.push(p.toUpperCase());
    }
  }
  if (player.position) candidates.push(player.position.toUpperCase());

  for (const pos of KNOWN_POSITIONS) {
    if (candidates.includes(pos)) return pos;
  }
  // Fallback: first candidate we have, even if not in KNOWN_POSITIONS.
  return candidates[0] ?? null;
}

function deriveStatus(player: SleeperPlayer): string {
  if (player.active === false) return "inactive";
  const raw = (player.status ?? "").toLowerCase();
  if (raw.includes("injured reserve") || raw === "ir") return "ir";
  if (raw.includes("practice squad")) return "practice_squad";
  if (raw.includes("suspended")) return "suspended";
  if (raw.includes("physically unable") || raw === "pup") return "pup";
  if (raw.includes("non football injury") || raw === "nfi") return "nfi";
  if (raw.includes("retired")) return "retired";
  if (raw.includes("inactive")) return "inactive";
  return "active";
}

async function main() {
  const supabase = getServiceClient();

  console.log("Fetching Sleeper players...");
  const response = await fetch("https://api.sleeper.app/v1/players/nfl", {
    headers: { "user-agent": "ffbeacon-sync/1.0" },
  });
  if (!response.ok) throw new Error(`Sleeper API responded ${response.status}`);
  const playersBySleeperId = (await response.json()) as Record<string, SleeperPlayer>;
  console.log(`Got ${Object.keys(playersBySleeperId).length} total players from Sleeper`);

  const now = new Date().toISOString();
  type StagedRow = {
    sleeperId: string;
    slug: string;
    first_name: string;
    last_name: string;
    full_name: string;
    position: string;
    team: string | null;
    status: string;
    birth_date: string | null;
    height_inches: number | null;
    weight_lbs: number | null;
    college: string | null;
    years_experience: number | null;
    sleeperRaw: Record<string, unknown>;
  };

  const staged: StagedRow[] = [];
  let skippedNoName = 0;
  let skippedRetired = 0;
  let skippedNoPosition = 0;

  for (const [sleeperId, player] of Object.entries(playersBySleeperId)) {
    if (!sleeperId) continue;

    const first = (player.first_name ?? player.full_name?.split(" ")[0] ?? "").trim();
    const last = (player.last_name ?? player.full_name?.split(" ").slice(1).join(" ") ?? "").trim();
    const fullName = (player.full_name ?? `${first} ${last}`).trim();
    if (!fullName) {
      skippedNoName++;
      continue;
    }

    const position = pickPrimaryPosition(player);
    if (!position) {
      skippedNoPosition++;
      continue;
    }

    // Skip clearly retired with no team affiliation. Keep retired players
    // who still have a team (rare, usually mid-season retirement filings)
    // and keep IR/PUP/suspended which Sleeper reports as active=true.
    if (player.active === false && !player.team) {
      skippedRetired++;
      continue;
    }

    const baseName = `${first}-${last}`.trim();
    const slug = slugify(baseName ? `${baseName}-${sleeperId}` : `player-${sleeperId}`);

    staged.push({
      sleeperId,
      slug,
      first_name: first || "Unknown",
      last_name: last || sleeperId,
      full_name: fullName || `${first} ${last}`.trim() || sleeperId,
      position,
      team: player.team ?? null,
      status: deriveStatus(player),
      birth_date: player.birth_date ?? null,
      height_inches: parseHeight(player.height),
      weight_lbs: parseWeight(player.weight),
      college: player.college ?? null,
      years_experience: typeof player.years_exp === "number" ? player.years_exp : null,
      sleeperRaw: player as unknown as Record<string, unknown>,
    });
  }

  console.log(
    `Staged ${staged.length} players for upsert. ` +
      `Skipped: no-name=${skippedNoName}, no-position=${skippedNoPosition}, retired-no-team=${skippedRetired}.`,
  );

  // Load existing rows by slug so we can merge external_ids / metadata /
  // source_synced_at instead of clobbering sibling-source keys. Chunk size
  // 200 keeps the SELECT URL under PostgREST's ~16KB header limit (slugs
  // are ~20 chars; 1000 of them blow the limit).
  console.log("Loading existing rows for merge (by slug)...");
  const existingBySlug = new Map<
    string,
    {
      external_ids: Record<string, unknown>;
      metadata: Record<string, unknown>;
      source_synced_at: Record<string, unknown>;
    }
  >();
  const targetSlugs = staged.map((s) => s.slug);
  for (let from = 0; from < targetSlugs.length; from += 200) {
    const batch = targetSlugs.slice(from, from + 200);
    const data = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("slug, external_ids, metadata, source_synced_at")
          .in("slug", batch);
        if (error) throw error;
        return data ?? [];
      },
      { label: `players select page ${from}` },
    );
    for (const p of data) {
      existingBySlug.set(p.slug, {
        external_ids: (p.external_ids as Record<string, unknown>) ?? {},
        metadata: (p.metadata as Record<string, unknown>) ?? {},
        source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
      });
    }
  }

  const mergedRows = staged.map((s) => {
    const prev = existingBySlug.get(s.slug);
    const externalIds = {
      ...((prev?.external_ids as Record<string, unknown>) ?? {}),
      sleeper: s.sleeperId,
    };
    const metadata = {
      ...((prev?.metadata as Record<string, unknown>) ?? {}),
      sleeper: s.sleeperRaw,
    };
    const sourceSyncedAt = {
      ...((prev?.source_synced_at as Record<string, unknown>) ?? {}),
      sleeper: now,
    };
    // full_name is a generated column derived from first_name+last_name;
    // do not include it in the upsert payload.
    return {
      slug: s.slug,
      external_ids: externalIds,
      first_name: s.first_name,
      last_name: s.last_name,
      position: s.position,
      team: s.team,
      status: s.status,
      birth_date: s.birth_date,
      height_inches: s.height_inches,
      weight_lbs: s.weight_lbs,
      college: s.college,
      years_experience: s.years_experience,
      metadata,
      source_synced_at: sourceSyncedAt,
      updated_at: now,
    };
  });

  console.log(`Upserting ${mergedRows.length} players...`);
  let upserted = 0;
  for (let i = 0; i < mergedRows.length; i += 300) {
    const chunk = mergedRows.slice(i, i + 300);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("players")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(chunk as any, { onConflict: "slug", ignoreDuplicates: false });
        if (error) throw error;
      },
      { label: `players upsert chunk ${i}` },
    );
    upserted += chunk.length;
    process.stdout.write(`  ${upserted}/${mergedRows.length}\r`);
  }

  console.log(`\nDone. Upserted ${upserted} players.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
