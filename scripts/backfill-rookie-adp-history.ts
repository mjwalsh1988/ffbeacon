/**
 * One-time historical backfill of rookie ADP (FantasyPros dynasty rookie
 * rankings, mirrored by DynastyProcess).
 *
 * DynastyProcess commits files/db_fpecr_latest.csv to its GitHub repo on a
 * schedule, so the file's git history IS the historical archive. This script
 * walks that history newest -> oldest and writes one player_market_snapshots
 * partition per commit (source='dynastyprocess', the adp "rookie" key), keyed on
 * that commit's scrape_date. Idempotent via the (source, season_type, season,
 * sleeper_player_id, snapshot_date) unique constraint, so re-running is safe and
 * converges with the nightly sync (both use the shared resolve/build helpers).
 *
 * NEVER wire this into a cron. It is a one-time / manual operation, invoked via
 * `npm run backfill:rookie-adp` and folded into `npm run backfill:all`.
 *
 * GUARDRAILS (mirroring the DynastyProcess values backfill, with two deliberate
 * differences called out below):
 *   - SCHEMA-DRIFT STOP: before processing a commit, confirm the CSV still
 *     carries the columns we read (REQUIRED_FPECR_COLUMNS). db_fpecr_latest.csv
 *     is WIDE and its peripheral columns (image urls, ownership) churn, so unlike
 *     the narrow values file we guard on a required SUBSET, not the whole header.
 *     A missing required column, a 404, or an unreadable file stops the walk.
 *   - 3-YEAR ABSOLUTE CEILING: never walk past today minus 3 years.
 *   - ANOMALOUS ZERO ROOKIE ROWS: the FantasyPros rookie page is published
 *     year-round (verified: rows present every week across the full 3-year
 *     window, in-season included), so a commit with zero page_type='dynasty-rk'
 *     rows is an anomaly, a malformed historical commit or a renamed page. To
 *     avoid one bad historical commit aborting a multi-year walk, a single empty
 *     commit is SKIPPED (not a stop, unlike the values backfill). A persistent
 *     rename is still caught: if the FIRST inspected commits never yield rookie
 *     rows, abort. The nightly sync, which reads only the current file, throws on
 *     zero instead (a live break should surface, not silently write nothing).
 *   - MATCH DECAY (non-fatal): older snapshots match fewer players. A snapshot
 *     that resolves ZERO sleeper ids (yet had rookie rows) stops the walk, since
 *     that means the crosswalk naming diverged.
 *   - Respect the GitHub API: paginate commits, back off on rate limits, cache
 *     the crosswalk once for the whole run.
 */

import { getServiceClient } from "./_supabase";
import { parseCsv, parseCsvHeader } from "../lib/csv";
import {
  REQUIRED_FPECR_COLUMNS,
  extractRookieRankings,
  buildMergeNameToSleeper,
  loadPlayerLookup,
  resolveRookie,
  buildRookieInsert,
  seasonForScrapeDate,
} from "../lib/sync-rookie-adp";
import { withRetry } from "../lib/supabase/retry";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

const REPO = "dynastyprocess/data";
const FILE_PATH = "files/db_fpecr_latest.csv";
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits`;
const RAW_AT = (sha: string) => `https://raw.githubusercontent.com/${REPO}/${sha}/${FILE_PATH}`;
const CROSSWALK_URL = `https://raw.githubusercontent.com/${REPO}/master/files/db_playerids.csv`;

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;
const UPSERT_BATCH_SIZE = 500;
// If the newest N commits never yield a single rookie row, the page_type was
// likely renamed. Abort rather than silently walk three years of nothing.
const EMPTY_START_ABORT = 8;

type Commit = { sha: string; date: string };

function hasRequiredColumns(header: string[]): boolean {
  const cols = new Set(header.map((s) => s.trim()));
  return REQUIRED_FPECR_COLUMNS.every((c) => cols.has(c));
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
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
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
  if (!res.ok) throw new Error(`GitHub commits API ${res.status} on page ${page}`);
  const body = (await res.json()) as Array<{
    sha: string;
    commit?: { committer?: { date?: string }; author?: { date?: string } };
  }>;
  return body.map((c) => ({
    sha: c.sha,
    date: c.commit?.committer?.date ?? c.commit?.author?.date ?? "",
  }));
}

type SnapshotResult = { written: number; matchedSleeper: number; scrapeDate: string | null };

async function processSnapshot(
  supabase: SupabaseClient<Database>,
  text: string,
  players: Awaited<ReturnType<typeof loadPlayerLookup>>,
  mergeToSleeper: ReturnType<typeof buildMergeNameToSleeper>,
): Promise<SnapshotResult> {
  const rookies = extractRookieRankings(parseCsv(text));
  if (rookies.length === 0) return { written: 0, matchedSleeper: 0, scrapeDate: null };

  const scrapeDate = rookies[0].scrapeDate;
  const nowIso = new Date().toISOString();
  const inserts = [];
  const seenSleeperIds = new Set<string>();

  for (const row of rookies) {
    const season = seasonForScrapeDate(row.scrapeDate);
    if (season === null) continue;
    const { sleeperId, playerId } = resolveRookie(row, mergeToSleeper, players);
    if (!sleeperId) continue;
    if (seenSleeperIds.has(sleeperId)) continue;
    seenSleeperIds.add(sleeperId);
    inserts.push(buildRookieInsert(row, season, sleeperId, playerId, nowIso));
  }

  let written = 0;
  for (let i = 0; i < inserts.length; i += UPSERT_BATCH_SIZE) {
    const chunk = inserts.slice(i, i + UPSERT_BATCH_SIZE);
    // Retry transient socket closes so one blip does not abort a multi-year walk.
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("player_market_snapshots")
          .upsert(chunk, {
            onConflict: "source,season_type,season,sleeper_player_id,snapshot_date",
          });
        if (error) throw error;
      },
      { label: `rookie backfill upsert ${scrapeDate}` },
    );
    written += chunk.length;
  }
  return { written, matchedSleeper: inserts.length, scrapeDate };
}

async function main() {
  const supabase = getServiceClient();
  const ceilingMs = Date.now() - THREE_YEARS_MS;

  console.log("Loading players...");
  const players = await loadPlayerLookup(supabase);

  console.log("Fetching id crosswalk (once)...");
  const crosswalkRes = await withRetry(
    () =>
      fetch(CROSSWALK_URL, {
        headers: { accept: "text/csv", "user-agent": "ffbeacon-backfill/1.0" },
      }),
    { label: "crosswalk fetch" },
  );
  if (!crosswalkRes.ok) throw new Error(`crosswalk fetch failed: HTTP ${crosswalkRes.status}`);
  const mergeToSleeper = buildMergeNameToSleeper(parseCsv(await crosswalkRes.text()));
  console.log(`  ${mergeToSleeper.withPos.size} merge_name -> sleeper_id mappings`);

  const seenDates = new Set<string>();
  let commitsProcessed = 0;
  let snapshotsWritten = 0;
  let rowsWritten = 0;
  let emptyRookieCommits = 0;
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

      const rawRes = await withRetry(
        () =>
          fetch(RAW_AT(c.sha), {
            headers: { accept: "text/csv", "user-agent": "ffbeacon-backfill/1.0" },
          }),
        { label: `raw fetch ${c.sha.slice(0, 7)}` },
      );
      if (rawRes.status === 404 || !rawRes.ok) {
        stopReason = `file missing/unreadable at commit ${c.sha.slice(0, 7)} (HTTP ${rawRes.status})`;
        walking = false;
        break;
      }
      const text = await rawRes.text();

      if (!hasRequiredColumns(parseCsvHeader(text))) {
        stopReason = `schema drift at commit ${c.sha.slice(0, 7)} dated ${c.date} (a required column is gone)`;
        walking = false;
        break;
      }

      const snap = await processSnapshot(supabase, text, players, mergeToSleeper);

      // Zero rookie rows is anomalous (the page is published year-round). Skip a
      // lone bad historical commit rather than abort the walk, but if the newest
      // commits never produce rookie rows, the page was renamed: abort.
      if (snap.scrapeDate === null) {
        emptyRookieCommits += 1;
        if (snapshotsWritten === 0 && emptyRookieCommits >= EMPTY_START_ABORT) {
          stopReason = `no rookie rows in the newest ${emptyRookieCommits} commits (page_type '${"dynasty-rk"}' may have been renamed)`;
          walking = false;
          break;
        }
        continue;
      }

      if (seenDates.has(snap.scrapeDate)) {
        console.log(`  commit ${c.sha.slice(0, 7)}: scrape_date ${snap.scrapeDate} already written, skipping`);
        continue;
      }

      // Had rookie rows but matched nobody: crosswalk naming diverged, stop.
      if (snap.written === 0) {
        stopReason = `zero sleeper matches at commit ${c.sha.slice(0, 7)} dated ${c.date} (scrape_date ${snap.scrapeDate})`;
        walking = false;
        break;
      }

      snapshotsWritten += 1;
      rowsWritten += snap.written;
      seenDates.add(snap.scrapeDate);
      if (!newestDate) newestDate = snap.scrapeDate;
      oldestDate = snap.scrapeDate;
      console.log(
        `  commit ${c.sha.slice(0, 7)} (${c.date.slice(0, 10)}): wrote ${snap.written} rookie rows (scrape_date ${snap.scrapeDate})`,
      );
    }

    page += 1;
  }

  console.log("\n=== Rookie ADP backfill report ===");
  console.log(`Commits inspected:   ${commitsProcessed}`);
  console.log(`Snapshots written:   ${snapshotsWritten}`);
  console.log(`Rookie rows written: ${rowsWritten}`);
  console.log(`Empty-rookie skips:  ${emptyRookieCommits}`);
  console.log(`Date range covered:  ${oldestDate ?? "n/a"} .. ${newestDate ?? "n/a"}`);
  console.log(`Stop reason:         ${stopReason}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
