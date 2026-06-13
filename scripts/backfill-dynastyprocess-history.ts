/**
 * One-time historical backfill of DynastyProcess player values.
 *
 * DynastyProcess commits files/values-players.csv to its GitHub repo on a
 * schedule, so the file's git history IS the historical archive. This script
 * walks that history newest -> oldest and writes one player_value_history
 * snapshot per commit, keyed on that commit's scrape_date. Idempotent via the
 * (player_id, format_config_id, source, captured_at) unique constraint, so
 * re-running is safe.
 *
 * NEVER wire this into the nightly cron. It is a one-time / manual operation,
 * invoked via `npm run backfill:dynastyprocess` and folded into
 * `npm run backfill:all` ahead of calculate:trends.
 *
 * GUARDRAILS (see prompt / progress.md T080):
 *   - SCHEMA-DRIFT HARD STOP: before processing a commit, compare its CSV
 *     header (exact column-name set) to the verified header. Any difference,
 *     a 404, or a missing file stops the backward walk immediately. We keep
 *     everything backfilled so far and exit cleanly. No adapting old schemas.
 *   - 3-YEAR ABSOLUTE CEILING: never walk past today minus 3 years, even if the
 *     schema is still valid. Stop at whichever comes first.
 *   - MATCH DECAY (non-fatal): older snapshots match fewer players (retired /
 *     renamed). Log unmatched per snapshot. Abort the walk only when a snapshot
 *     writes ZERO rows.
 *   - Respect the GitHub API: paginate commits, back off on rate limits, and
 *     cache db_playerids.csv once for the whole run.
 */

import { getServiceClient } from "./_supabase";
import { parseCsv, parseCsvHeader } from "../lib/csv";
import {
  normalizeName,
  scrapeDateToCapturedAt,
  buildFpToSleeper,
} from "../lib/sync-dynastyprocess";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/database.types";

const REPO = "dynastyprocess/data";
const FILE_PATH = "files/values-players.csv";
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits`;
const RAW_AT = (sha: string) => `https://raw.githubusercontent.com/${REPO}/${sha}/${FILE_PATH}`;
const CROSSWALK_URL = `https://raw.githubusercontent.com/${REPO}/master/files/db_playerids.csv`;
const SOURCE_SLUG = "dynastyprocess";

// The verified live header. Backfill stops the moment a commit's header set
// differs from this set in any way.
const EXPECTED_HEADER = [
  "player",
  "pos",
  "team",
  "age",
  "draft_year",
  "ecr_1qb",
  "ecr_2qb",
  "ecr_pos",
  "value_1qb",
  "value_2qb",
  "scrape_date",
  "fp_id",
];

const TARGETS: Array<{ formatSlug: "dynasty-ppr-std" | "dynasty-ppr-sflex"; valueCol: string }> = [
  { formatSlug: "dynasty-ppr-std", valueCol: "value_1qb" },
  { formatSlug: "dynasty-ppr-sflex", valueCol: "value_2qb" },
];

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

type Commit = { sha: string; date: string };

function headerSetEquals(actual: string[]): boolean {
  const a = new Set(actual.map((s) => s.trim()));
  if (a.size !== EXPECTED_HEADER.length) return false;
  return EXPECTED_HEADER.every((col) => a.has(col));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** GitHub API fetch with rate-limit backoff. Honors an optional GITHUB_TOKEN. */
async function ghFetch(url: string, attempt = 1): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "ffbeacon-backfill/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  const remaining = res.headers.get("x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && remaining === "0" && attempt <= 6) {
    const resetAt = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const retryAfter = Number(res.headers.get("retry-after")) * 1000;
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : Number.isFinite(resetAt) && resetAt > Date.now()
        ? Math.min(resetAt - Date.now() + 1000, 120_000)
        : Math.min(2 ** attempt * 1000, 60_000);
    console.warn(`  GitHub rate limited; waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt})...`);
    await sleep(waitMs);
    return ghFetch(url, attempt + 1);
  }
  return res;
}

async function listCommitsPage(page: number): Promise<Commit[]> {
  const url = `${COMMITS_API}?path=${encodeURIComponent(FILE_PATH)}&per_page=100&page=${page}`;
  const res = await ghFetch(url);
  if (!res.ok) {
    throw new Error(`GitHub commits API ${res.status} on page ${page}`);
  }
  const body = (await res.json()) as Array<{
    sha: string;
    commit?: { committer?: { date?: string }; author?: { date?: string } };
  }>;
  return body.map((c) => ({
    sha: c.sha,
    date: c.commit?.committer?.date ?? c.commit?.author?.date ?? "",
  }));
}

type PlayerMaps = {
  formatBySlug: Map<string, string>;
  playerBySleeperId: Map<string, string>;
  playerBySlugTail: Map<string, string>;
  playerByName: Map<string, string>;
};

function trailingNumericId(slug: string): string | null {
  const m = slug.match(/-(\d+)$/);
  return m ? m[1] : null;
}

async function loadPlayerMaps(supabase: SupabaseClient<Database>): Promise<PlayerMaps> {
  const { data: formats, error: fErr } = await supabase.from("format_configs").select("id, slug");
  if (fErr) throw fErr;
  const formatBySlug = new Map((formats ?? []).map((f) => [f.slug, f.id]));

  const playerBySleeperId = new Map<string, string>();
  const playerBySlugTail = new Map<string, string>();
  const playerByName = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("players")
      .select("id, slug, external_ids, first_name, last_name, position")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const p of data as Array<{
      id: string;
      slug: string;
      external_ids: unknown;
      first_name: string;
      last_name: string;
      position: string;
    }>) {
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
      if (sleeperId) playerBySleeperId.set(sleeperId, p.id);
      const tail = trailingNumericId(p.slug);
      if (tail) playerBySlugTail.set(tail, p.id);
      const nameKey = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
      if (!playerByName.has(nameKey)) playerByName.set(nameKey, p.id);
    }
    if (data.length < PAGE) break;
  }
  return { formatBySlug, playerBySleeperId, playerBySlugTail, playerByName };
}

type SnapshotResult = { written: number; unmatched: number; scrapeDate: string | null };

async function processSnapshot(
  supabase: SupabaseClient<Database>,
  records: Record<string, string>[],
  maps: PlayerMaps,
  fpToSleeper: Map<string, string>,
  perFormat: Map<string, number>,
): Promise<SnapshotResult> {
  let written = 0;
  let unmatched = 0;
  let scrapeDate: string | null = null;

  const resolvePlayerId = (rec: Record<string, string>, position: string): string | undefined => {
    const fpId = (rec.fp_id ?? "").trim();
    const sleeperId = fpId ? fpToSleeper.get(fpId) : undefined;
    if (sleeperId) {
      const bySleeper =
        maps.playerBySleeperId.get(sleeperId) ?? maps.playerBySlugTail.get(sleeperId);
      if (bySleeper) return bySleeper;
    }
    return maps.playerByName.get(`${normalizeName(rec.player ?? "")}|${position}`);
  };

  for (const target of TARGETS) {
    const formatId = maps.formatBySlug.get(target.formatSlug);
    if (!formatId) continue;
    const rows: Array<{
      player_id: string;
      format_config_id: string;
      value: number;
      source: string;
      captured_at: string;
      metadata: Json;
    }> = [];
    // Dedupe rows that resolve to the same player within one scrape; they would
    // collide on the conflict key (captured_at is constant). Keep first (the
    // CSV is rank-sorted, so first = better-ranked).
    const seenPlayerIds = new Set<string>();

    for (const rec of records) {
      const position = (rec.pos ?? "").trim().toUpperCase();
      if (!position) continue;
      const value = Number(rec[target.valueCol]);
      if (!Number.isFinite(value)) continue;
      const capturedAt = scrapeDateToCapturedAt(rec.scrape_date ?? "");
      if (!capturedAt) continue;
      if (!scrapeDate) scrapeDate = (rec.scrape_date ?? "").trim();

      const playerId = resolvePlayerId(rec, position);
      if (!playerId) {
        // Count unmatched once (use the first target as the canonical pass).
        if (target.formatSlug === "dynasty-ppr-std") unmatched += 1;
        continue;
      }
      if (seenPlayerIds.has(playerId)) continue;
      seenPlayerIds.add(playerId);
      rows.push({
        player_id: playerId,
        format_config_id: formatId,
        value,
        source: SOURCE_SLUG,
        captured_at: capturedAt,
        metadata: rec as unknown as Json,
      });
    }

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase.from("player_value_history").upsert(chunk, {
        onConflict: "player_id,format_config_id,source,captured_at",
        ignoreDuplicates: false,
      });
      if (error) throw error;
      written += chunk.length;
      perFormat.set(target.formatSlug, (perFormat.get(target.formatSlug) ?? 0) + chunk.length);
    }
  }

  return { written, unmatched, scrapeDate };
}

async function main() {
  const supabase = getServiceClient();
  const ceilingMs = Date.now() - THREE_YEARS_MS;

  console.log("Loading players + formats...");
  const maps = await loadPlayerMaps(supabase);

  console.log("Fetching id crosswalk (once)...");
  const crosswalkRes = await fetch(CROSSWALK_URL, {
    headers: { accept: "text/csv", "user-agent": "ffbeacon-backfill/1.0" },
  });
  if (!crosswalkRes.ok) {
    throw new Error(`crosswalk fetch failed: HTTP ${crosswalkRes.status}`);
  }
  const fpToSleeper = buildFpToSleeper(parseCsv(await crosswalkRes.text()));
  console.log(`  ${fpToSleeper.size} fantasypros_id -> sleeper_id mappings`);

  const perFormat = new Map<string, number>();
  const seenDates = new Set<string>();
  let commitsProcessed = 0;
  let snapshotsWritten = 0;
  let newestDate: string | null = null;
  let oldestDate: string | null = null;
  let stopReason = "reached end of commit history";

  let page = 1;
  let walking = true;
  while (walking) {
    const commits = await listCommitsPage(page);
    if (commits.length === 0) break;

    for (const c of commits) {
      const commitMs = c.date ? new Date(c.date).getTime() : NaN;
      if (Number.isFinite(commitMs) && commitMs < ceilingMs) {
        stopReason = `3-year ceiling reached (commit ${c.sha.slice(0, 7)} dated ${c.date})`;
        walking = false;
        break;
      }
      commitsProcessed += 1;

      const rawRes = await fetch(RAW_AT(c.sha), {
        headers: { accept: "text/csv", "user-agent": "ffbeacon-backfill/1.0" },
      });
      if (rawRes.status === 404 || !rawRes.ok) {
        stopReason = `file missing/unreadable at commit ${c.sha.slice(0, 7)} (HTTP ${rawRes.status})`;
        walking = false;
        break;
      }
      const text = await rawRes.text();

      const header = parseCsvHeader(text);
      if (!headerSetEquals(header)) {
        stopReason = `schema drift at commit ${c.sha.slice(0, 7)} dated ${c.date} (header: ${header.join(",")})`;
        walking = false;
        break;
      }

      const records = parseCsv(text);
      const peekDate = (records[0]?.scrape_date ?? "").trim();
      if (peekDate && seenDates.has(peekDate)) {
        console.log(`  commit ${c.sha.slice(0, 7)}: scrape_date ${peekDate} already written, skipping`);
        continue;
      }

      const snap = await processSnapshot(supabase, records, maps, fpToSleeper, perFormat);
      if (snap.written === 0) {
        stopReason = `zero rows matched at commit ${c.sha.slice(0, 7)} dated ${c.date} (scrape_date ${snap.scrapeDate ?? "?"})`;
        walking = false;
        break;
      }

      snapshotsWritten += 1;
      if (snap.scrapeDate) {
        seenDates.add(snap.scrapeDate);
        if (!newestDate) newestDate = snap.scrapeDate;
        oldestDate = snap.scrapeDate;
      }
      console.log(
        `  commit ${c.sha.slice(0, 7)} (${c.date.slice(0, 10)}): wrote ${snap.written} rows, ${snap.unmatched} unmatched (scrape_date ${snap.scrapeDate})`,
      );
    }

    page += 1;
  }

  console.log("\n=== DynastyProcess backfill report ===");
  console.log(`Commits inspected:   ${commitsProcessed}`);
  console.log(`Snapshots written:   ${snapshotsWritten}`);
  console.log(`Date range covered:  ${oldestDate ?? "n/a"} .. ${newestDate ?? "n/a"}`);
  console.log(`Stop reason:         ${stopReason}`);
  console.log("Per-format rows:");
  for (const target of TARGETS) {
    console.log(`  ${target.formatSlug}: ${perFormat.get(target.formatSlug) ?? 0}`);
  }
  if (snapshotsWritten > 0) {
    console.log("\nRun `npm run calculate:trends` (or `npm run backfill:all`) to refresh trends.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
