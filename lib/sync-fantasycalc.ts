/**
 * FantasyCalc value sync (library form).
 *
 * Extracted from scripts/sync-fantasycalc.ts so both the CLI script and the
 * Vercel cron endpoint (`/api/cron/sync-fantasycalc`) call the same path.
 * See the script's header for the full pipeline description.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

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

const MUST_DIFFER_PAIRS: Array<[string, string]> = [
  ["redraft-std-std", "redraft-half-std"],
  ["redraft-std-std", "redraft-ppr-std"],
  ["redraft-half-std", "redraft-ppr-std"],
  ["redraft-ppr-std", "redraft-ppr-sflex"],
  ["dynasty-ppr-std", "dynasty-ppr-sflex"],
  ["redraft-ppr-std", "dynasty-ppr-std"],
];

export type FantasyCalcSyncResult = {
  ok: boolean;
  totalRows: number;
  unmatched: number;
  mergedPlayers: number;
  perFormat: Array<{ formatSlug: string; rows: number }>;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

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
  if (upper === "RDP" || upper === "PICK") return null;
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
      headers: { accept: "application/json", "user-agent": "ffbeacon-sync/1.0" },
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

function trailingNumericId(slug: string): string | null {
  const m = slug.match(/-(\d+)$/);
  return m ? m[1] : null;
}

export async function runFantasyCalcSync(
  supabase: SupabaseClient<Database>,
): Promise<FantasyCalcSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const warnings: string[] = [];

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

  const playerBySleeperId = new Map<string, string>();
  const playerBySlugTail = new Map<string, string>();
  const playerByName = new Map<string, string>();

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
    fingerprint: Map<string, number>;
  };

  const batches: Batch[] = [];
  let totalUnmatched = 0;

  for (const target of TARGETS) {
    if (!ALLOWED_FANTASYCALC_FORMAT_SLUGS.has(target.formatSlug)) {
      throw new Error(
        `runFantasyCalcSync: refusing to fetch "${target.formatSlug}" — not allowed.`,
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
    let unmatchedInBatch = 0;

    for (const r of rawRows) {
      if (!r || typeof r.player !== "object" || r.player === null) continue;
      const position = normalizePosition(r.player.position);
      if (!position) continue;
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
      const sleeperId =
        typeof r.player.sleeperId === "string" ? r.player.sleeperId.trim() : null;
      const nameKey = `${normalizeName(r.player.name)}|${position}`;
      fingerprint.set(nameKey, r.value);

      let playerId: string | undefined;
      if (sleeperId) {
        playerId = playerBySleeperId.get(sleeperId);
        if (!playerId) playerId = playerBySlugTail.get(sleeperId);
      }
      if (!playerId) playerId = playerByName.get(nameKey);
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

    totalUnmatched += unmatchedInBatch;
    if (rows.length === 0) continue;
    batches.push({ target, formatId, rows, rawRows, fingerprint });
  }

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
    // Non-fatal canary. FantasyCalc is a real JSON API queried with explicit
    // scoring params (ppr / numQbs), so identical values across a "must differ"
    // pair means the API ignored a param for this run, or genuinely had no
    // spread for these players that day. We record it for visibility but never
    // abort the write: dropping a whole night of good data over a soft signal
    // is the worse failure. (Compare sync-ktc.ts, where the same canary stays
    // fatal because that path scrapes HTML and identical bytes there means the
    // scrape silently fell back to a client-filtered view: see migration 0011.)
    if (shared > 0 && identical === shared) {
      const msg = `${a} and ${b} returned identical values for all ${shared} shared players (FantasyCalc may have ignored a scoring param this run).`;
      warnings.push(msg);
      console.warn(`  WARN: ${msg}`);
    }
  }

  let totalRows = 0;
  const perFormat: Array<{ formatSlug: string; rows: number }> = [];
  for (const batch of batches) {
    let formatRows = 0;
    for (let i = 0; i < batch.rows.length; i += 200) {
      const chunk = batch.rows.slice(i, i + 200);
      const { error } = await supabase
        .from("player_value_history")
        .upsert(chunk, {
          onConflict: "player_id,format_config_id,source,captured_at",
          ignoreDuplicates: false,
        });
      if (error) throw error;
      totalRows += chunk.length;
      formatRows += chunk.length;
    }
    perFormat.push({ formatSlug: batch.target.formatSlug, rows: formatRows });
  }

  // A run that writes nothing is a failure, not a quiet success. Every target
  // returning empty means FantasyCalc was unreachable or changed its response
  // shape, and we want the cron to surface a 500 so the outage is visible
  // rather than logging a green "ok" with no data behind it.
  if (totalRows === 0) {
    throw new Error(
      "runFantasyCalcSync: wrote 0 rows — every FantasyCalc target returned empty or failed to fetch.",
    );
  }

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
    if (error) throw error;
    mergeCount++;
  }

  const finished = Date.now();
  console.log(
    `\nDone. Inserted ${totalRows} player_value_history rows. Merged ${mergeCount} players. Unmatched: ${totalUnmatched}. Warnings: ${warnings.length}`,
  );

  return {
    ok: true,
    totalRows,
    unmatched: totalUnmatched,
    mergedPlayers: mergeCount,
    perFormat,
    warnings,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
