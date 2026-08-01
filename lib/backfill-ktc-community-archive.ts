/**
 * KTC historical backfill via the community-maintained Google Sheet
 * (u/325xi5mt, https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs).
 *
 * KTC's own /histories endpoint only reaches back ~6 months (today: 2025-11-18).
 * The community sheet has snapshotted the top 500 KTC values daily since
 * 2020-04-01. This script ingests a configurable date window from that sheet
 * to extend our KTC history back further than the public endpoint supports.
 *
 * One-time bootstrap. NOT for nightly cron, the regular sync-ktc cron
 * (scripts/sync-ktc.ts via /api/cron/sync-ktc) handles all current-day writes.
 *
 * Coverage scope (intentional limits):
 *   - KTC values only. FantasyCalc historical is not in the archive (the FC
 *     columns in the sheet are current-snapshot, daily-overwritten).
 *   - Top 500 dynasty players only (matches the sheet).
 *   - Dynasty-PPR formats: dynasty-ppr-std (1QB), dynasty-ppr-sflex (SF),
 *     and dynasty-ppr-tep-sflex (derived per-date via applyKtcTep).
 *   - No redraft history (the sheet doesn't carry it).
 *   - No pick history (the sheet's pick columns don't map to our
 *     (season, round, slot) schema; live sync handles picks going forward).
 *
 * Player matching mirrors sync-ktc.ts:
 *   normalizeName(playerName) + position -> players.id
 * Position is inferred from the current-snapshot 1QB tab (Position column).
 * Unmatched names are logged but not fatal.
 *
 * Idempotency: upsert on (player_id, format_config_id, source, captured_at)
 * with ignoreDuplicates: true. captured_at is canonicalized to UTC noon for
 * each historical date, identical to scripts/backfill-ktc-history.ts so the
 * two backfills coexist without duplicate rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyKtcTep, tepTierFromTePremiumBonus, type TepPlayer } from "./ktc-tep";
import { withRetry } from "./supabase/retry";
import type { Database, Json } from "./database.types";

const SHEET_ID = "1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs";
const SHEET_ZIP_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=zip`;
const SOURCE_SLUG = "ktc";
const UPSERT_BATCH_SIZE = 500;
const TEP_DERIVE: Array<{ targetSlug: string; baseSlug: string }> = [
  { targetSlug: "dynasty-ppr-tep-sflex", baseSlug: "dynasty-ppr-sflex" },
];

type FormatKey = "dynasty-ppr-std" | "dynasty-ppr-sflex";

type ParsedTab = {
  // headers[0] = "Date"; headers[1..N] = player or pick names
  headers: string[];
  // Each row: [date, ...cells]
  rows: Array<{ date: string; values: Array<number | null> }>;
};

type HistoryRowInsert = {
  player_id: string;
  format_config_id: string;
  value: number;
  source: string;
  captured_at: string;
  metadata: Json;
};

export type CommunityArchiveResult = {
  ok: boolean;
  sinceDate: string;
  datesProcessed: number;
  upsertedRows: number;
  perFormat: Record<string, number>;
  unmatchedNames: string[];
  skippedPickColumns: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim();
}

function isPickColumn(name: string): boolean {
  // Pick column headers look like "2024 Early 1st", "2025 Late 2nd", etc.
  return /^\d{4}\s+(Early|Mid|Late)\s+\d/i.test(name);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, "")).trim();
}

// HTML parser tuned for Google Sheets export shape. Each tab is a single
// <table> with <tr><td>...</td>...</tr> rows. We regex out <tr> blocks then
// <td> cells inside each.
function parseTab(html: string): ParsedTab {
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const allTrs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) allTrs.push(m[1]);
  // First non-empty row is the freeze/title row (often empty cells); the
  // header row is the first row whose first cell == "Date".
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < allTrs.length; i++) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    const localRe = new RegExp(tdRe.source, "g");
    while ((cm = localRe.exec(allTrs[i])) !== null) cells.push(stripTags(cm[1]));
    if (cells.length > 0 && cells[0] === "Date") {
      headerIdx = i;
      headers = cells;
      break;
    }
  }
  if (headerIdx === -1) throw new Error("parseTab: no header row found (no 'Date' first column)");

  const rows: ParsedTab["rows"] = [];
  for (let i = headerIdx + 1; i < allTrs.length; i++) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    const localRe = new RegExp(tdRe.source, "g");
    while ((cm = localRe.exec(allTrs[i])) !== null) cells.push(stripTags(cm[1]));
    if (cells.length === 0) continue;
    const date = cells[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const values: Array<number | null> = [];
    for (let j = 1; j < headers.length; j++) {
      const raw = cells[j] ?? "";
      if (raw === "") {
        values.push(null);
      } else {
        const n = Number(raw);
        values.push(Number.isFinite(n) ? n : null);
      }
    }
    rows.push({ date, values });
  }
  return { headers, rows };
}

// Read the small current-snapshot tab to extract Player Name -> Position.
// Headers of 1QB.html (verified):
//   row 1: "Updated ...", "Position Rank", "Position", "Team", "Value", ...
//   row 2+: player rows
function parsePositionMap(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const allTrs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) allTrs.push(m[1]);
  // Find header row: first row whose cells[1] === "Position Rank"
  let headerIdx = -1;
  let nameIdx = 0;
  let positionIdx = 2;
  for (let i = 0; i < allTrs.length; i++) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    const localRe = new RegExp(tdRe.source, "g");
    while ((cm = localRe.exec(allTrs[i])) !== null) cells.push(stripTags(cm[1]));
    if (cells[1] === "Position Rank") {
      headerIdx = i;
      // Player name is the first cell after the leading "Updated..." cell? No:
      // verified row 1 first cell is "Updated MM/DD/YY at HH:MMam" so nameIdx=0.
      nameIdx = 0;
      positionIdx = cells.indexOf("Position");
      break;
    }
  }
  if (headerIdx === -1) return out;
  for (let i = headerIdx + 1; i < allTrs.length; i++) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    const localRe = new RegExp(tdRe.source, "g");
    while ((cm = localRe.exec(allTrs[i])) !== null) cells.push(stripTags(cm[1]));
    if (cells.length === 0) continue;
    const name = cells[nameIdx];
    const position = cells[positionIdx];
    if (!name || !position) continue;
    if (!/^[A-Z]{1,3}$/.test(position)) continue; // skip non-position values
    if (!out.has(name)) out.set(name, position);
  }
  return out;
}

async function downloadAndExtractTabs(): Promise<{
  current1qb: string;
  historical1qb: string;
  historicalSf: string;
}> {
  // Google's zip export uses data-descriptor encoding (compSize=0 in the
  // local file header), which our naive in-process parser couldn't follow.
  // Easier to shell out to the system `unzip` binary, which is available
  // in Git Bash on Windows and on every Linux/macOS CI runner. The zip is
  // small (~7 MB) and one-time.
  const { writeFileSync, readFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");

  console.log(`Downloading workbook from Google Sheets...`);
  const res = await fetch(SHEET_ZIP_URL, {
    headers: { "user-agent": "Mozilla/5.0 (ffbeacon backfill)" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Workbook download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  ${buf.length} bytes`);

  const dir = mkdtempSync(join(tmpdir(), "ktc-community-"));
  const zipPath = join(dir, "sheet.zip");
  writeFileSync(zipPath, buf);
  try {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir], { stdio: "inherit" });
  } catch (err) {
    throw new Error(
      `unzip failed (${(err as Error).message}). Install the 'unzip' binary or run via Git Bash.`,
    );
  }

  const need = (name: string): string => {
    try {
      return readFileSync(join(dir, name), "utf8");
    } catch {
      throw new Error(`Workbook missing expected tab: "${name}"`);
    }
  };

  const out = {
    current1qb: need("1QB.html"),
    historical1qb: need("1QB Historical Data.html"),
    historicalSf: need("SF Historical Data.html"),
  };
  // Best-effort cleanup
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // tmp dir cleanup is non-critical
  }
  return out;
}

export async function runCommunityArchiveBackfill(
  supabase: SupabaseClient<Database>,
  opts: { sinceDate: string },
): Promise<CommunityArchiveResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const sinceMs = Date.parse(`${opts.sinceDate}T00:00:00Z`);
  if (!Number.isFinite(sinceMs)) {
    throw new Error(`runCommunityArchiveBackfill: invalid sinceDate "${opts.sinceDate}"`);
  }

  const { current1qb, historical1qb, historicalSf } = await downloadAndExtractTabs();

  console.log("Parsing position map from 1QB current snapshot...");
  const positionByName = parsePositionMap(current1qb);
  console.log(`  ${positionByName.size} (name -> position) entries`);

  console.log("Parsing historical tabs...");
  const tab1qb = parseTab(historical1qb);
  const tabSf = parseTab(historicalSf);
  console.log(`  1QB Historical: ${tab1qb.headers.length - 1} cols x ${tab1qb.rows.length} rows`);
  console.log(`  SF  Historical: ${tabSf.headers.length - 1} cols x ${tabSf.rows.length} rows`);

  // Load format_configs
  const { data: formats, error: fErr } = await supabase
    .from("format_configs")
    .select("id, slug, te_premium_bonus");
  if (fErr) throw fErr;
  if (!formats) throw new Error("missing format_configs");
  const formatBySlug = new Map(
    formats.map((f) => [f.slug, { id: f.id, te_premium_bonus: Number(f.te_premium_bonus ?? 0) }]),
  );
  const requiredSlugs = ["dynasty-ppr-std", "dynasty-ppr-sflex", "dynasty-ppr-tep-sflex"];
  for (const slug of requiredSlugs) {
    if (!formatBySlug.has(slug)) {
      throw new Error(`format_config missing slug "${slug}"`);
    }
  }

  // Load all players for name+position matching
  console.log("Loading players for name matching...");
  type PlayerRow = {
    id: string;
    first_name: string;
    last_name: string;
    position: string;
  };
  const players: PlayerRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const pageOffset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position")
          .range(pageOffset, pageOffset + PAGE - 1);
        if (error) throw error;
        return (data ?? []) as PlayerRow[];
      },
      { label: `players select page ${from}` },
    );
    if (page.length === 0) break;
    players.push(...page);
    if (page.length < PAGE) break;
  }
  const playerByKey = new Map<string, string>();
  const positionByPlayerId = new Map<string, string>();
  for (const p of players) {
    const key = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    playerByKey.set(key, p.id);
    positionByPlayerId.set(p.id, p.position);
  }
  console.log(`  ${players.length} players loaded`);

  const perFormat: Record<string, number> = {
    "dynasty-ppr-std": 0,
    "dynasty-ppr-sflex": 0,
    "dynasty-ppr-tep-sflex": 0,
  };
  const unmatchedSet = new Set<string>();
  let skippedPickColumns = 0;
  const allRows: HistoryRowInsert[] = [];
  // Per-date sflex value lookup so we can derive TEP-sflex after the sflex
  // pass completes. Key: "YYYY-MM-DD" -> Array<{player_id, position, value}>.
  const sflexByDate = new Map<
    string,
    Array<{ player_id: string; position: string; value: number }>
  >();
  const datesSeen = new Set<string>();

  const processTab = (
    tab: ParsedTab,
    targetFormat: FormatKey,
    captureSflexForTep: boolean,
  ) => {
    const formatId = formatBySlug.get(targetFormat)!.id;
    const dateColumn = 0;
    const playerHeaders = tab.headers.slice(1); // strip "Date"
    // Pre-resolve each column's (player_id, position) once
    const colResolved: Array<{ player_id: string; position: string } | null> = playerHeaders.map(
      (header) => {
        if (isPickColumn(header)) {
          skippedPickColumns++;
          return null;
        }
        const position = positionByName.get(header);
        if (!position) {
          unmatchedSet.add(`${header} (no position from snapshot)`);
          return null;
        }
        const key = `${normalizeName(header)}|${position}`;
        const playerId = playerByKey.get(key);
        if (!playerId) {
          unmatchedSet.add(`${header}|${position}`);
          return null;
        }
        return { player_id: playerId, position };
      },
    );

    for (const row of tab.rows) {
      const rowMs = Date.parse(`${row.date}T00:00:00Z`);
      if (!Number.isFinite(rowMs) || rowMs < sinceMs) continue;
      datesSeen.add(row.date);
      const captured_at = `${row.date}T12:00:00.000Z`;
      for (let i = 0; i < row.values.length; i++) {
        const v = row.values[i];
        if (v === null || !Number.isFinite(v)) continue;
        const resolved = colResolved[i];
        if (!resolved) continue;
        const value = Math.round(v);
        if (!Number.isFinite(value) || value <= 0) continue;
        allRows.push({
          player_id: resolved.player_id,
          format_config_id: formatId,
          value,
          source: SOURCE_SLUG,
          captured_at,
          metadata: {
            ktc_community_archive: {
              source: "u/325xi5mt google sheet",
              sheet_id: SHEET_ID,
              tab: targetFormat === "dynasty-ppr-std" ? "1QB Historical Data" : "SF Historical Data",
              date: row.date,
              column_header: playerHeaders[i],
              raw_value: v,
            },
          } as unknown as Json,
        });
        perFormat[targetFormat]++;
        if (captureSflexForTep) {
          let bucket = sflexByDate.get(row.date);
          if (!bucket) {
            bucket = [];
            sflexByDate.set(row.date, bucket);
          }
          bucket.push({
            player_id: resolved.player_id,
            position: resolved.position,
            value,
          });
        }
      }
    }
  };

  console.log(`Mapping 1QB historical -> dynasty-ppr-std...`);
  processTab(tab1qb, "dynasty-ppr-std", false);
  console.log(`  ${perFormat["dynasty-ppr-std"]} rows queued`);

  console.log(`Mapping SF historical -> dynasty-ppr-sflex (also capturing for TEP derive)...`);
  processTab(tabSf, "dynasty-ppr-sflex", true);
  console.log(`  ${perFormat["dynasty-ppr-sflex"]} rows queued`);

  // Derive TEP-sflex per date
  for (const { targetSlug, baseSlug } of TEP_DERIVE) {
    if (baseSlug !== "dynasty-ppr-sflex") continue;
    const targetEntry = formatBySlug.get(targetSlug);
    if (!targetEntry) continue;
    const tier = tepTierFromTePremiumBonus(targetEntry.te_premium_bonus);
    if (!tier) {
      console.warn(
        `  ${targetSlug}: te_premium_bonus=${targetEntry.te_premium_bonus} non-positive; skipping TEP derive`,
      );
      continue;
    }
    console.log(`Deriving ${targetSlug} from ${baseSlug} for ${sflexByDate.size} dates (tier ${tier})...`);
    let derived = 0;
    let skippedSmall = 0;
    for (const [date, bucket] of sflexByDate) {
      if (bucket.length <= 25) {
        skippedSmall++;
        continue;
      }
      const input: TepPlayer[] = bucket.map((b) => ({
        player_id: b.player_id,
        position: b.position,
        value: b.value,
      }));
      const output = applyKtcTep(input, tier);
      const captured_at = `${date}T12:00:00.000Z`;
      for (const p of output) {
        allRows.push({
          player_id: p.player_id,
          format_config_id: targetEntry.id,
          value: p.value,
          source: SOURCE_SLUG,
          captured_at,
          metadata: {
            ktc_community_archive: {
              source: "u/325xi5mt google sheet",
              sheet_id: SHEET_ID,
              date,
              derived_from: { base_format_slug: baseSlug },
              algorithm: "applyKtcTep",
              tep_tier: tier,
            },
          } as unknown as Json,
        });
        derived++;
      }
    }
    perFormat[targetSlug] = (perFormat[targetSlug] ?? 0) + derived;
    console.log(`  ${derived} TEP-adjusted rows (${skippedSmall} dates skipped: <=25 players)`);
  }

  console.log(`\nUpserting ${allRows.length} player_value_history rows...`);
  let upserted = 0;
  for (let i = 0; i < allRows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = allRows.slice(i, i + UPSERT_BATCH_SIZE);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("player_value_history")
          .upsert(chunk, {
            onConflict: "player_id,format_config_id,source,captured_at",
            ignoreDuplicates: true,
          });
        if (error) throw error;
      },
      { label: `player_value_history upsert chunk ${i / UPSERT_BATCH_SIZE}` },
    );
    upserted += chunk.length;
    if (i % (UPSERT_BATCH_SIZE * 10) === 0 && i > 0) {
      console.log(`  progress: ${upserted}/${allRows.length}`);
    }
  }

  const finished = Date.now();
  console.log(
    `\nDone. upserted=${upserted} dates=${datesSeen.size} unmatched=${unmatchedSet.size} skippedPickCols=${skippedPickColumns}`,
  );

  return {
    ok: true,
    sinceDate: opts.sinceDate,
    datesProcessed: datesSeen.size,
    upsertedRows: upserted,
    perFormat,
    unmatchedNames: [...unmatchedSet].slice(0, 100),
    skippedPickColumns,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
