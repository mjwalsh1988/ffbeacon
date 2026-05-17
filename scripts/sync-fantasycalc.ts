/**
 * FantasyCalc value sync.
 *
 * Hits https://api.fantasycalc.com/values/current for the six format variants
 * FantasyCalc natively publishes:
 *
 *   redraft-std-std    (isDynasty=false, numQbs=1, ppr=0)
 *   redraft-half-std   (isDynasty=false, numQbs=1, ppr=0.5)
 *   redraft-ppr-std    (isDynasty=false, numQbs=1, ppr=1)
 *   redraft-ppr-sflex  (isDynasty=false, numQbs=2, ppr=1)
 *   dynasty-ppr-std    (isDynasty=true,  numQbs=1, ppr=1)
 *   dynasty-ppr-sflex  (isDynasty=true,  numQbs=2, ppr=1)
 *
 * FantasyCalc does NOT publish TEP variants. dynasty-ppr-tep-sflex and
 * redraft-ppr-tep stay outside our supported_format_slugs. If we later want
 * FantasyCalc TEP, we'd apply our own TEP derivation algorithm in this
 * pipeline mirroring lib/ktc-tep.ts. Not done here.
 *
 * Player mapping resolves in this order (per-FantasyCalc-row, both layers
 * driven off FantasyCalc's own sleeperId):
 *   1) players.external_ids.sleeper === FantasyCalc.player.sleeperId
 *   2) players.slug ends with "-<FantasyCalc.sleeperId>". Sleeper sync embeds
 *      the Sleeper ID in the slug, so this recovers matches when our players
 *      row was created by Sleeper sync but is missing `external_ids.sleeper`
 *      (some KTC-touched rows ended up that way after ordering issues with
 *      earlier syncs).
 *   3) Normalized name + position match (last-resort, mirrors sync-ktc.ts).
 *      Used when FantasyCalc returns a row with no sleeperId at all.
 *
 * Writes:
 *   - player_value_history (source='fantasycalc', captured_at=run timestamp,
 *     metadata = full FantasyCalc row including the player block)
 *   - players (merge fantasycalc into external_ids, metadata, source_synced_at)
 *
 * Defenses:
 *   - ALLOWED_FANTASYCALC_FORMAT_SLUGS: refuses to write any format not on
 *     the explicit allow list, mirroring sync-ktc.ts's fail-closed pattern.
 *   - MUST_DIFFER_PAIRS: throws if two distinct format calls return
 *     byte-for-byte identical values for every shared player (the 0011 KTC
 *     class of bug). We sample pre-write and abort the run if it ever fires.
 *
 * Run: npm run sync:fantasycalc
 *      (or `npm run sync:full` to chain ktc + fantasycalc + rankings + trends)
 */

import { getServiceClient } from "./_supabase";
import type { Json } from "../lib/database.types";

type FantasyCalcPlayer = {
  id: number;
  name: string;
  mflId?: string | null;
  sleeperId?: string | null;
  position?: string | null;
  maybeTeam?: string | null;
};

type FantasyCalcRow = {
  player: FantasyCalcPlayer;
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day?: number | null;
  redraftValue?: number | null;
  combinedValue?: number | null;
  // Other fields are preserved verbatim into metadata.
};

type FormatTarget = {
  formatSlug: string;
  isDynasty: boolean;
  numQbs: 1 | 2;
  ppr: 0 | 0.5 | 1;
};

const FANTASYCALC_ENDPOINT = "https://api.fantasycalc.com/values/current";
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_SLUG = "fantasycalc";
const NUM_TEAMS = 12;

// Hard-coded allow list. Refuse to write to any format outside this set.
// Mirrors sync-ktc.ts's ALLOWED_KTC_FORMAT_SLUGS.
const ALLOWED_FANTASYCALC_FORMAT_SLUGS = new Set<string>([
  "redraft-std-std",
  "redraft-half-std",
  "redraft-ppr-std",
  "redraft-ppr-sflex",
  "dynasty-ppr-std",
  "dynasty-ppr-sflex",
]);

const TARGETS: FormatTarget[] = [
  { formatSlug: "redraft-std-std", isDynasty: false, numQbs: 1, ppr: 0 },
  { formatSlug: "redraft-half-std", isDynasty: false, numQbs: 1, ppr: 0.5 },
  { formatSlug: "redraft-ppr-std", isDynasty: false, numQbs: 1, ppr: 1 },
  { formatSlug: "redraft-ppr-sflex", isDynasty: false, numQbs: 2, ppr: 1 },
  { formatSlug: "dynasty-ppr-std", isDynasty: true, numQbs: 1, ppr: 1 },
  { formatSlug: "dynasty-ppr-sflex", isDynasty: true, numQbs: 2, ppr: 1 },
];

// Pairs that MUST yield distinct datasets. If a pair returns byte-for-byte
// identical values for every shared player, the API isn't actually
// honoring our query params and we should abort. (Same defense KTC uses.)
const MUST_DIFFER_PAIRS: Array<[string, string]> = [
  // Closest-to-collapsing pair (PPR vs Half-PPR is small but real for non-WR).
  // First production run measured 16% identical — well below the 100% kill
  // threshold, but the smallest margin among our pairs, so it's the most
  // sensitive canary if FantasyCalc ever silently collapses scoring variants.
  ["redraft-std-std", "redraft-half-std"],
  ["redraft-std-std", "redraft-ppr-std"],
  ["redraft-half-std", "redraft-ppr-std"],
  ["redraft-ppr-std", "redraft-ppr-sflex"],
  ["dynasty-ppr-std", "dynasty-ppr-sflex"],
  ["redraft-ppr-std", "dynasty-ppr-std"],
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim();
}

function normalizePosition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "RDP" || upper === "PICK") return null; // skip draft picks
  return upper;
}

function buildUrl(target: FormatTarget): string {
  const params = new URLSearchParams({
    isDynasty: String(target.isDynasty),
    numQbs: String(target.numQbs),
    numTeams: String(NUM_TEAMS),
    ppr: String(target.ppr),
  });
  return `${FANTASYCALC_ENDPOINT}?${params.toString()}`;
}

async function fetchTarget(target: FormatTarget): Promise<FantasyCalcRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(target), {
      headers: {
        accept: "application/json",
        "user-agent": "ffbeacon-sync/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`  ${target.formatSlug}: HTTP ${response.status}`);
      return [];
    }
    const body = await response.json();
    if (!Array.isArray(body)) {
      console.warn(`  ${target.formatSlug}: response is not an array`);
      return [];
    }
    return body as FantasyCalcRow[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ${target.formatSlug}: fetch failed - ${msg}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Extract a trailing numeric ID from a player slug. sync-sleeper-players.ts
// builds slugs like "bijan-robinson-9509". When a row's external_ids.sleeper
// is missing (sometimes the case for KTC-matched rows pre-dating Sleeper
// fill-in), the slug tail is the most reliable surrogate.
function trailingNumericId(slug: string): string | null {
  const m = slug.match(/-(\d+)$/);
  return m ? m[1] : null;
}

async function main() {
  const supabase = getServiceClient();

  console.log("Loading format_configs and existing players...");
  const { data: formats, error: formatErr } = await supabase
    .from("format_configs")
    .select("id, slug");
  if (formatErr) throw formatErr;
  if (!formats) throw new Error("missing format data");
  const formatBySlug = new Map(formats.map((f) => [f.slug, f.id]));

  type PlayerRow = {
    id: string;
    slug: string;
    external_ids: unknown;
    first_name: string;
    last_name: string;
    position: string;
  };
  const players: PlayerRow[] = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("players")
      .select("id, slug, external_ids, first_name, last_name, position")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    players.push(...(data as PlayerRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${players.length} players loaded`);

  // Build lookup maps for the three fallback layers.
  const playerBySleeperId = new Map<string, string>(); // sleeperId -> player_id
  const playerBySlugTail = new Map<string, string>(); // trailing-digits -> player_id
  const playerByName = new Map<string, string>(); // "name|position" -> player_id

  for (const p of players) {
    const ext = (p.external_ids as Record<string, unknown>) ?? {};
    const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
    if (sleeperId) playerBySleeperId.set(sleeperId, p.id);
    const tail = trailingNumericId(p.slug);
    if (tail) playerBySlugTail.set(tail, p.id);
    const nameKey = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    if (!playerByName.has(nameKey)) playerByName.set(nameKey, p.id);
  }

  const now = new Date().toISOString();

  type Batch = {
    target: FormatTarget;
    formatId: string;
    rows: Array<{
      player_id: string;
      format_config_id: string;
      value: number;
      source: string;
      captured_at: string;
      metadata: Json;
    }>;
    rawRows: FantasyCalcRow[];
    fingerprint: Map<string, number>; // "name|position" -> value
    matchedByLayer: { sleeperId: number; slugTail: number; nameOnly: number };
  };

  const batches: Batch[] = [];
  let totalUnmatched = 0;

  for (const target of TARGETS) {
    if (!ALLOWED_FANTASYCALC_FORMAT_SLUGS.has(target.formatSlug)) {
      throw new Error(
        `sync-fantasycalc.ts: refusing to fetch "${target.formatSlug}" — not in ALLOWED_FANTASYCALC_FORMAT_SLUGS.`,
      );
    }
    const formatId = formatBySlug.get(target.formatSlug);
    if (!formatId) {
      console.warn(`  ${target.formatSlug}: no format_config found`);
      continue;
    }
    console.log(`Fetching ${target.formatSlug}...`);
    const rawRows = await fetchTarget(target);
    if (rawRows.length === 0) continue;
    console.log(`  ${rawRows.length} FantasyCalc entries`);

    const rows: Batch["rows"] = [];
    const fingerprint = new Map<string, number>();
    const matchedByLayer = { sleeperId: 0, slugTail: 0, nameOnly: 0 };
    let unmatchedInBatch = 0;

    for (const r of rawRows) {
      // Defensive shape check: a malformed upstream row missing `player`
      // would crash the run on `r.player.position`. The FantasyCalc API has
      // been stable, but we accept the raw object verbatim into metadata, so
      // we'd rather skip a bad row than abort the whole sync.
      if (!r || typeof r.player !== "object" || r.player === null) continue;
      const position = normalizePosition(r.player.position);
      if (!position) continue; // skip draft picks
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
      const sleeperId =
        typeof r.player.sleeperId === "string" ? r.player.sleeperId.trim() : null;
      const nameKey = `${normalizeName(r.player.name)}|${position}`;
      fingerprint.set(nameKey, r.value);

      let playerId: string | undefined;
      if (sleeperId) {
        playerId = playerBySleeperId.get(sleeperId);
        if (playerId) matchedByLayer.sleeperId++;
        if (!playerId) {
          playerId = playerBySlugTail.get(sleeperId);
          if (playerId) matchedByLayer.slugTail++;
        }
      }
      if (!playerId) {
        playerId = playerByName.get(nameKey);
        if (playerId) matchedByLayer.nameOnly++;
      }
      if (!playerId) {
        unmatchedInBatch++;
        continue;
      }

      rows.push({
        player_id: playerId,
        format_config_id: formatId,
        value: r.value,
        source: SOURCE_SLUG,
        captured_at: now,
        metadata: r as unknown as Json,
      });
    }

    console.log(
      `  matched: sleeperId=${matchedByLayer.sleeperId}, slugTail=${matchedByLayer.slugTail}, nameOnly=${matchedByLayer.nameOnly}, unmatched=${unmatchedInBatch}`,
    );
    totalUnmatched += unmatchedInBatch;

    if (rows.length === 0) continue;
    batches.push({
      target,
      formatId,
      rows,
      rawRows,
      fingerprint,
      matchedByLayer,
    });
  }

  // Pairwise must-differ sanity check before any write.
  const byFormat = new Map(batches.map((b) => [b.target.formatSlug, b.fingerprint]));
  for (const [a, b] of MUST_DIFFER_PAIRS) {
    const fa = byFormat.get(a);
    const fb = byFormat.get(b);
    if (!fa || !fb) continue;
    let shared = 0;
    let identical = 0;
    for (const [key, va] of fa) {
      const vb = fb.get(key);
      if (typeof vb !== "number") continue;
      shared++;
      if (va === vb) identical++;
    }
    if (shared > 0 && identical === shared) {
      throw new Error(
        `sync-fantasycalc.ts: ${a} and ${b} returned byte-for-byte identical values for ${shared} shared players. ` +
          `Query params likely didn't toggle the dataset. Investigate before writing.`,
      );
    }
  }

  // Write phase --------------------------------------------------------------
  let totalRows = 0;
  for (const batch of batches) {
    for (let i = 0; i < batch.rows.length; i += 200) {
      const chunk = batch.rows.slice(i, i + 200);
      const { error } = await supabase
        .from("player_value_history")
        .upsert(chunk, {
          onConflict: "player_id,format_config_id,source,captured_at",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error("Upsert error:", error.message);
        throw error;
      }
      totalRows += chunk.length;
    }
  }

  // Merge FantasyCalc identifiers + metadata into players (one row per player,
  // dedup across all batches so we don't update a player six times). Use the
  // FIRST occurrence of each player (any format) as the canonical raw payload.
  console.log("Merging FantasyCalc payloads into players...");
  const updatesByPlayerId = new Map<string, FantasyCalcRow>();
  for (const batch of batches) {
    for (const raw of batch.rawRows) {
      if (!raw || typeof raw.player !== "object" || raw.player === null) continue;
      const position = normalizePosition(raw.player.position);
      if (!position) continue;
      const sleeperId =
        typeof raw.player.sleeperId === "string" ? raw.player.sleeperId.trim() : null;
      const nameKey = `${normalizeName(raw.player.name)}|${position}`;
      const playerId =
        (sleeperId && playerBySleeperId.get(sleeperId)) ||
        (sleeperId && playerBySlugTail.get(sleeperId)) ||
        playerByName.get(nameKey);
      if (!playerId) continue;
      if (!updatesByPlayerId.has(playerId)) updatesByPlayerId.set(playerId, raw);
    }
  }

  const updateIds = Array.from(updatesByPlayerId.keys());
  const existingByPlayerId = new Map<
    string,
    {
      external_ids: Record<string, unknown>;
      source_synced_at: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }
  >();
  // Page size 200 keeps the PostgREST GET URL under the 16 KB header limit.
  // 1000 UUIDs in `.in("id", ...)` produces a ~15.6 KB URL which trips
  // undici's HeadersOverflowError on some Supabase deployments.
  for (let from = 0; from < updateIds.length; from += 200) {
    const batchIds = updateIds.slice(from, from + 200);
    const { data, error } = await supabase
      .from("players")
      .select("id, external_ids, source_synced_at, metadata")
      .in("id", batchIds);
    if (error) throw error;
    for (const p of data ?? []) {
      existingByPlayerId.set(p.id, {
        external_ids: (p.external_ids as Record<string, unknown>) ?? {},
        source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
        metadata: (p.metadata as Record<string, unknown>) ?? {},
      });
    }
  }

  let mergeCount = 0;
  for (const [playerId, raw] of updatesByPlayerId) {
    const existing = existingByPlayerId.get(playerId);
    if (!existing) continue;
    const fcId = String(raw.player.id);
    const existingFcId =
      typeof (existing.external_ids as Record<string, unknown>).fantasycalc === "string"
        ? ((existing.external_ids as Record<string, unknown>).fantasycalc as string)
        : null;
    const externalIds: Json = {
      ...(existing.external_ids as Record<string, Json>),
      fantasycalc: existingFcId ?? fcId,
    };
    const sourceSyncedAt: Json = {
      ...(existing.source_synced_at as Record<string, Json>),
      fantasycalc: now,
    };
    const metadata: Json = {
      ...(existing.metadata as Record<string, Json>),
      fantasycalc: raw as unknown as Json,
    };
    const { error } = await supabase
      .from("players")
      .update({ external_ids: externalIds, source_synced_at: sourceSyncedAt, metadata })
      .eq("id", playerId);
    if (error) {
      console.error("Player merge error:", error.message);
      throw error;
    }
    mergeCount++;
  }

  console.log(
    `\nDone. Inserted ${totalRows} player_value_history rows across ${batches.length} formats. ` +
      `Merged FantasyCalc payload into ${mergeCount} players. Unmatched FantasyCalc rows (summed across formats): ${totalUnmatched}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
