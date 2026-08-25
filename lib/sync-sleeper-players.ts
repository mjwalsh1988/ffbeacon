/**
 * Sleeper player sync (library form).
 *
 * Shared by the Vercel cron endpoint (app/api/cron/sync-sleeper-players) and
 * the CLI (scripts/sync-sleeper-players.ts). Pulls the full NFL player dump and
 * upserts every player Sleeper considers in-scope for fantasy/IDP rosters into
 * the players table.
 *
 * WHY THIS RUNS NIGHTLY
 * players.metadata.sleeper.injury_status is the only place the site learns that
 * a player is on IR, on PUP, suspended, or questionable. Power Pulse, FAAB,
 * Trade Ideas and the schedule board all read it, and every one of them treats
 * a season-ending designation as a zero for the rest of the year. A stale row
 * is therefore not a cosmetic problem: it silently projects hurt players as
 * healthy and healthy players as hurt, in both directions at once, and nothing
 * downstream can tell the difference. This sync existed from day one but was
 * never scheduled, and between 2026-05-18 and 2026-08-25 the table did not move
 * while 104 players went on IR and several came off it.
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
 * Slug stability, and the bug that hid here for three months:
 *   - Slug encodes the sleeper id (e.g. "patrick-mahomes-4046"). A row's slug
 *     is assigned ONCE and never recomputed, so downstream lookups by slug-tail
 *     (sync-fantasycalc.ts, lib/league-power-rankings.ts) stay stable and the
 *     player's public URL does not move when Sleeper edits a name.
 *   - The original version documented that rule but did not implement it: it
 *     recomputed the slug from the CURRENT name every run and looked existing
 *     rows up BY SLUG. The first time Sleeper renamed anyone, the recomputed
 *     slug missed the existing row, the upsert tried to INSERT a second row for
 *     the same player, and the run died on the unique index over
 *     external_ids->>'sleeper'. Sleeper renaming "Kenneth Gainwell" to "Kenny
 *     Gainwell" is what surfaced it. resolveExistingBySleeperId() below keys the
 *     lookup on the Sleeper id instead, which is the only identifier that
 *     actually survives a rename.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { getSleeperPlayers, type SleeperPlayer } from "./sleeper";
import { withRetry } from "./supabase/retry";

/** PostgREST select pages. Keeps each response comfortably bounded. */
const SELECT_PAGE = 1000;
/** Rows per upsert. 300 keeps the request body well inside limits. */
const UPSERT_BATCH_SIZE = 300;
/** Slugs per merge-select. 200 keeps the URL under PostgREST's ~16KB header cap. */
const MERGE_SELECT_CHUNK = 200;

/**
 * Positions we recognize for the players.position column. Anything outside
 * this set is preserved verbatim from Sleeper (so an "OL" stays "OL"); this
 * list is just the priority order when fantasy_positions has multiple entries.
 */
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

/**
 * Slug generator. Byte-for-byte the same transform scripts/_supabase.ts uses,
 * because an existing row's slug must keep resolving to the same string.
 */
export function slugifyPlayer(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseHeight(value: string | undefined): number | null {
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

export function parseWeight(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function pickPrimaryPosition(player: SleeperPlayer): string | null {
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

export function deriveStatus(player: SleeperPlayer): string {
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

type StagedRow = {
  sleeperId: string;
  /** Slug we would assign if this player were new. May be replaced by the stored one. */
  proposedSlug: string;
  first_name: string;
  last_name: string;
  position: string;
  team: string | null;
  status: string;
  injuryStatus: string | null;
  birth_date: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  college: string | null;
  years_experience: number | null;
  sleeperRaw: Record<string, unknown>;
};

export type SleeperPlayersSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  fetched: number;
  staged: number;
  upserted: number;
  /** Rows whose stored slug was kept because Sleeper changed the player's name. */
  renamed: number;
  /** How many upserted players currently carry any injury designation. */
  withInjuryDesignation: number;
  /** How many carry a designation that keeps them out beyond a single week. */
  longTermOut: number;
  skippedNoName: number;
  skippedNoPosition: number;
  skippedRetiredNoTeam: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/**
 * Designations that keep a player out for longer than one week.
 *
 * Reported for observability only; the projection model reads the designation
 * itself. Kept in step with LONG_TERM_INJURY_STATUSES in
 * lib/power-pulse/project.ts.
 */
const LONG_TERM_DESIGNATIONS = new Set(["IR", "PUP", "NA", "SUS", "COV", "DNR"]);

/**
 * Map every Sleeper id we already store to the slug it was first filed under.
 *
 * Keyed on the Sleeper id rather than the slug on purpose. The slug is derived
 * from a name and names change; the Sleeper id is the only stable handle, and
 * it is the column the unique index enforces. Reading the whole table costs one
 * paginated scan of two small columns.
 */
async function resolveExistingBySleeperId(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  const bySleeperId = new Map<string, string>();
  for (let from = 0; ; from += SELECT_PAGE) {
    const rows = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("slug, sleeper_id:external_ids->>sleeper")
          .order("slug", { ascending: true })
          .range(from, from + SELECT_PAGE - 1)
          .overrideTypes<{ slug: string; sleeper_id: string | null }[]>();
        if (error) throw error;
        return data ?? [];
      },
      { label: `players slug map page ${from}` },
    );
    for (const row of rows) {
      if (row.sleeper_id) bySleeperId.set(row.sleeper_id, row.slug);
    }
    if (rows.length < SELECT_PAGE) break;
  }
  return bySleeperId;
}

export async function runSleeperPlayersSync(
  supabase: SupabaseClient<Database>,
): Promise<SleeperPlayersSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const finish = (
    partial: Omit<SleeperPlayersSyncResult, "ok" | "startedAt" | "finishedAt" | "durationMs">,
  ): SleeperPlayersSyncResult => {
    const finished = Date.now();
    return {
      ok: true,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      ...partial,
    };
  };

  const playersBySleeperId = await getSleeperPlayers();

  // A failed request and an empty league are not the same thing, and only one
  // of them is survivable. getSleeperPlayers returns null on failure, so an
  // empty object here would mean Sleeper answered with no players at all.
  // Either way we write nothing rather than deleting the roster of the NFL.
  if (playersBySleeperId === null) {
    throw new Error("Sleeper player dump request failed (no response)");
  }
  const fetched = Object.keys(playersBySleeperId).length;
  if (fetched === 0) {
    throw new Error("Sleeper player dump returned zero players");
  }

  const now = new Date().toISOString();
  const staged: StagedRow[] = [];
  let skippedNoName = 0;
  let skippedRetiredNoTeam = 0;
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

    // Skip clearly retired with no team affiliation. Keep retired players who
    // still have a team (rare, usually mid-season retirement filings) and keep
    // IR/PUP/suspended, which Sleeper reports as active=true.
    if (player.active === false && !player.team) {
      skippedRetiredNoTeam++;
      continue;
    }

    const baseName = `${first}-${last}`.trim();
    const proposedSlug = slugifyPlayer(
      baseName ? `${baseName}-${sleeperId}` : `player-${sleeperId}`,
    );

    const injuryStatus =
      typeof player.injury_status === "string" && player.injury_status.trim().length > 0
        ? player.injury_status.trim()
        : null;

    staged.push({
      sleeperId,
      proposedSlug,
      first_name: first || "Unknown",
      last_name: last || sleeperId,
      position,
      team: player.team ?? null,
      status: deriveStatus(player),
      injuryStatus,
      birth_date: player.birth_date ?? null,
      height_inches: parseHeight(player.height),
      weight_lbs: parseWeight(player.weight),
      college: player.college ?? null,
      years_experience: typeof player.years_exp === "number" ? player.years_exp : null,
      sleeperRaw: player as unknown as Record<string, unknown>,
    });
  }

  if (staged.length === 0) {
    return finish({
      skipped: true,
      reason: `Sleeper returned ${fetched} players but none passed the inclusion filter`,
      fetched,
      staged: 0,
      upserted: 0,
      renamed: 0,
      withInjuryDesignation: 0,
      longTermOut: 0,
      skippedNoName,
      skippedNoPosition,
      skippedRetiredNoTeam,
    });
  }

  // Resolve each staged player to the slug it is ALREADY filed under, so a
  // Sleeper rename updates the existing row instead of colliding with it.
  const slugBySleeperId = await resolveExistingBySleeperId(supabase);
  let renamed = 0;
  const slugFor = new Map<string, string>();
  for (const s of staged) {
    const stored = slugBySleeperId.get(s.sleeperId);
    if (stored && stored !== s.proposedSlug) renamed += 1;
    slugFor.set(s.sleeperId, stored ?? s.proposedSlug);
  }

  // Load the jsonb columns we merge into, keyed by the slug we will actually
  // write, so sibling sources' keys survive.
  const existingBySlug = new Map<
    string,
    {
      external_ids: Record<string, unknown>;
      metadata: Record<string, unknown>;
      source_synced_at: Record<string, unknown>;
    }
  >();
  const targetSlugs = [...new Set(staged.map((s) => slugFor.get(s.sleeperId) as string))];
  for (let from = 0; from < targetSlugs.length; from += MERGE_SELECT_CHUNK) {
    const batch = targetSlugs.slice(from, from + MERGE_SELECT_CHUNK);
    const data = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("slug, external_ids, metadata, source_synced_at")
          .in("slug", batch);
        if (error) throw error;
        return data ?? [];
      },
      { label: `players merge select page ${from}` },
    );
    for (const p of data) {
      existingBySlug.set(p.slug, {
        external_ids: (p.external_ids as Record<string, unknown>) ?? {},
        metadata: (p.metadata as Record<string, unknown>) ?? {},
        source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
      });
    }
  }

  let withInjuryDesignation = 0;
  let longTermOut = 0;

  const mergedRows = staged.map((s) => {
    const slug = slugFor.get(s.sleeperId) as string;
    const prev = existingBySlug.get(slug);
    const externalIds = {
      ...(prev?.external_ids ?? {}),
      sleeper: s.sleeperId,
    };
    const metadata = {
      ...(prev?.metadata ?? {}),
      sleeper: s.sleeperRaw,
    };
    const sourceSyncedAt = {
      ...(prev?.source_synced_at ?? {}),
      sleeper: now,
    };

    if (s.injuryStatus) {
      withInjuryDesignation += 1;
      if (LONG_TERM_DESIGNATIONS.has(s.injuryStatus.toUpperCase())) longTermOut += 1;
    }

    // full_name is a generated column derived from first_name + last_name; do
    // not include it in the upsert payload.
    return {
      slug,
      external_ids: externalIds as unknown as Json,
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
      metadata: metadata as unknown as Json,
      source_synced_at: sourceSyncedAt as unknown as Json,
      updated_at: now,
    };
  });

  let upserted = 0;
  for (let i = 0; i < mergedRows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = mergedRows.slice(i, i + UPSERT_BATCH_SIZE);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("players")
          .upsert(chunk, { onConflict: "slug", ignoreDuplicates: false });
        if (error) throw error;
      },
      { label: `players upsert chunk ${i}` },
    );
    upserted += chunk.length;
  }

  console.log(
    `[sync-sleeper-players] ${upserted} upserted from ${fetched} fetched. ` +
      `${renamed} kept an existing slug through a Sleeper rename. ` +
      `${withInjuryDesignation} carry a designation (${longTermOut} out beyond one week).`,
  );

  return finish({
    skipped: false,
    fetched,
    staged: staged.length,
    upserted,
    renamed,
    withInjuryDesignation,
    longTermOut,
    skippedNoName,
    skippedNoPosition,
    skippedRetiredNoTeam,
  });
}
