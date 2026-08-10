/**
 * Loads the Beacon Brief tunables from beacon_settings (category 'beacon_brief').
 *
 * Nothing about the pipeline is hardcoded: toggles, models, thresholds, the
 * selected Discord webhook, and every prompt live in the DB and are editable on
 * the admin Settings page. The DEFAULTS below are only fallbacks used when a row
 * is missing; they mirror migration 0092.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export interface BeaconBriefSettings {
  enabled: boolean;
  discordEnabled: boolean;
  webSearchEnabled: boolean;
  /**
   * Cap on web searches the research call may run. The server-side search loop
   * re-bills the whole accumulated conversation each round, so token cost grows
   * with the SQUARE of this number. 0 or less means no cap (ai.ts omits max_uses).
   *
   * Measured on our own logs: 2 searches averaged 39,755 input tokens per call,
   * 3 averaged 126,553. Each step up roughly triples the bill.
   */
  researchMaxSearches: number;
  /**
   * Ask the triage model whether the post already carries everything an accurate
   * article would say, before paying for research. Off researches every post,
   * which is what the pipeline did before migration 0186.
   */
  researchGateEnabled: boolean;
  /**
   * Characters of usable text below which a post always researches, whatever the
   * gate decides. A thin post is the one case where skipping research is
   * dangerous rather than merely thinner: it leaves the writer with nothing but
   * its own memory to build from. See the fabrication note in ./worker.ts.
   */
  researchGateMinPostChars: number;
  /**
   * Domains the research search may draw from. Empty searches the whole web.
   * Parsed from the comma-separated bb_research_domains setting.
   */
  researchDomains: string[];
  autopublish: boolean;
  contextThreshold: number;
  /**
   * How far back the follow-up matcher looks for a story a new post might
   * continue. Was 3 days, which let it reach across unrelated news cycles: 143 of
   * 215 merges landed in an article more than 12 hours old, and the mis-merges
   * clustered at the very top of the window.
   */
  followupLookbackHours: number;
  /**
   * A post whose relevance_tier is at or above this never merges into an existing
   * article, it always gets its own. 0 disables the floor, which is now the default.
   *
   * Shipped at 3 in migration 0169 and disabled in 0177. The classifier rates every
   * post about a current player's football situation a 3, which is every post that can
   * become an article, so a floor at 3 did not limit merging, it ended it: the floor
   * fired 129 times over four days while the matcher ran twice. The event key in
   * ./event-key.ts replaced the job this was doing, and it does not fire on a proven
   * same-event match at any tier.
   */
  mergeBlockRelevanceTier: number;
  /**
   * How far back an event key looks for the article that already covers this event.
   * Wider than the follow-up lookback because a signing reported on Tuesday is still
   * the same signing when it is made official on Thursday.
   */
  eventKeyWindowHours: number;
  /**
   * Ask the triage model whether a matched post actually changes the article before
   * paying for a rewrite. Off means every match rewrites, which is the old behaviour.
   */
  mergeGateEnabled: boolean;
  /**
   * Most articles the Brief may write about one player in 24 hours. A post that would
   * exceed it keeps its Discord card and lands in the Filtered queue instead of
   * publishing. 0 disables the cap.
   */
  playerArticleCapPerDay: number;
  /**
   * Model used to fold a follow-up into an existing article. Defaults to the triage
   * model: a merge edits an article that already exists rather than writing one from
   * nothing, and it runs with no web research, so the cheaper model is usually enough.
   * Set it to the article model when merge prose quality matters more than the cost.
   */
  modelMergeRewrite: string;
  /**
   * Age past which a Discord card is too old to update in place. A Discord edit
   * fires no notification and does not move the message, so patching a day-old
   * card is indistinguishable from posting nothing. Past this age the follow-up
   * gets its own card instead. 0 disables the check (always patch).
   */
  patchMaxAgeMinutes: number;
  queueMaxAttempts: number;
  discordJobsPerRun: number;
  articleJobsPerRun: number;
  backfillCount: number;
  maxItemsPerRun: number;
  maxPostAgeMinutes: number;
  workerMaxRuntimeMs: number;
  staleProcessingMinutes: number;
  discordPaceMs: number;
  matchSimilarityThreshold: number;
  matchCandidateLimit: number;
  /** Days after ingestion that a post stays under deletion watch. */
  deletionWatchDays: number;
  /**
   * Tapered checkpoints, in hours after ingestion, at which a post is
   * re-verified. Sorted ascending and de-duplicated on load.
   */
  deletionCheckHours: number[];
  /** How often the batched deletion sweep runs. */
  deletionSweepIntervalMinutes: number;
  /** Ceiling on posts re-verified in one sweep, so a backlog drains gradually. */
  deletionSweepMaxIds: number;
  /** Gap between recovery probes while the X integration is in outage. */
  xProbeIntervalMinutes: number;
  /** Minimum gap between alert emails for the same component. */
  alertCooldownMinutes: number;
  /**
   * Mark long system prompts for prompt caching. Billing-only: the model
   * receives identical input either way. Worth it because article writes
   * cluster (median gap between them is 12 seconds) and a cache read bills at
   * about a tenth of the input rate. Turn off if that pattern ever changes,
   * since an isolated call pays a 1.25x write for a cache nothing reads.
   */
  promptCacheEnabled: boolean;
  keywordFilterEnabled: boolean;
  keywordFilter: string;
  nonFootballFilterEnabled: boolean;
  relevanceFilterEnabled: boolean;
  /** Minimum CategorizeResult.relevance_tier a post needs to stay in the pipeline. */
  relevanceThreshold: number;
  modelArticle: string;
  /**
   * Model for the web-search research call, separate from modelArticle.
   *
   * Split in migration 0186. Research is fact gathering (search, read, quote the
   * source) and it was 95% of the Brief's Anthropic bill; writing is the part
   * that needs the stronger model, and it costs under two dollars a week. Set
   * this to modelArticle's value to put them back on one model.
   */
  modelResearch: string;
  modelTriage: string;
  webhookId: string;
  prompts: {
    categorize: string;
    researchGate: string;
    articleResearch: string;
    article: string;
    revisionRewrite: string;
    followupLink: string;
    /**
     * Asks whether a matched post changes the article at all. See ./merge.ts.
     * Replaced bb_revision_triage_prompt in migration 0177: same price, but it reads
     * the whole article body instead of a summary and it runs in one place instead of
     * two.
     */
    mergeGate: string;
  };
}

export const BEACON_BRIEF_DEFAULTS: BeaconBriefSettings = {
  enabled: true,
  discordEnabled: true,
  webSearchEnabled: true,
  researchMaxSearches: 2,
  researchGateEnabled: true,
  researchGateMinPostChars: 180,
  researchDomains: [],
  autopublish: true,
  contextThreshold: 1,
  followupLookbackHours: 12,
  mergeBlockRelevanceTier: 0,
  eventKeyWindowHours: 72,
  mergeGateEnabled: true,
  playerArticleCapPerDay: 3,
  modelMergeRewrite: "claude-haiku-4-5",
  patchMaxAgeMinutes: 120,
  queueMaxAttempts: 5,
  discordJobsPerRun: 25,
  articleJobsPerRun: 5,
  backfillCount: 0,
  maxItemsPerRun: 50,
  maxPostAgeMinutes: 180,
  workerMaxRuntimeMs: 50_000,
  staleProcessingMinutes: 10,
  discordPaceMs: 1000,
  matchSimilarityThreshold: 0.3,
  matchCandidateLimit: 8,
  deletionWatchDays: 7,
  // Two checks per article, and no more. X bills per post read, so every extra
  // checkpoint is a recurring cost multiplied by article volume, and volume
  // spikes hard in season. The 1-hour check catches the common case (a reporter
  // pulling a post they got wrong, which almost always happens fast); the 7-day
  // check is a final sweep before the article leaves the watch window. The old
  // fixed every-6-hours schedule spent 28 reads per article to cover the same
  // ground.
  deletionCheckHours: [1, 168],
  deletionSweepIntervalMinutes: 60,
  deletionSweepMaxIds: 300,
  xProbeIntervalMinutes: 15,
  alertCooldownMinutes: 360,
  promptCacheEnabled: true,
  keywordFilterEnabled: true,
  keywordFilter:
    "nba, basketball, world cup, fifa, soccer, golf, pga, mlb, baseball, nhl, hockey, tennis, ufc, boxing, olympics, cricket, formula 1, f1, nascar, wnba, march madness",
  nonFootballFilterEnabled: true,
  relevanceFilterEnabled: true,
  relevanceThreshold: 2,
  modelArticle: "claude-sonnet-4-6",
  modelResearch: "claude-haiku-4-5",
  modelTriage: "claude-haiku-4-5",
  webhookId: "",
  prompts: {
    categorize: "",
    researchGate: "",
    articleResearch: "",
    article: "",
    revisionRewrite: "",
    followupLink: "",
    mergeGate: "",
  },
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return fallback;
}
function asNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asStr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Parse the tapered deletion schedule from its comma-separated setting value.
 *
 * beacon_settings.value_type only allows number | boolean | string, so the list
 * ships as a string the same way bb_keyword_filter does. Junk entries are
 * dropped rather than throwing: a typo on the admin Settings page must not stop
 * the deletion watch, and an empty result falls back to the default schedule.
 * Sorted ascending and de-duplicated so the caller can walk it in order.
 */
export function parseCheckSchedule(v: unknown, fallback: number[]): number[] {
  if (typeof v !== "string") return fallback;
  const hours = [
    ...new Set(
      v
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
  return hours.length > 0 ? hours : fallback;
}

/**
 * Parse the research domain allowlist from its comma-separated setting value.
 *
 * Ships as a string for the same reason the deletion schedule does:
 * beacon_settings.value_type only allows number | boolean | string.
 *
 * The API wants bare hostnames, so a pasted URL is reduced to one rather than
 * rejected: "https://www.espn.com/nfl/" becomes "espn.com". Getting this wrong
 * in the other direction is expensive, because a malformed entry does not error,
 * it silently matches nothing and quietly narrows the search. An empty result
 * means no restriction, which is the correct reading of an empty field.
 */
export function parseDomainList(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return [
    ...new Set(
      v
        .split(",")
        .map((part) =>
          part
            .trim()
            .toLowerCase()
            .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
            .replace(/^www\./, "")
            .replace(/[/?#].*$/, "")
            .replace(/\.+$/, ""),
        )
        .filter((host) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)),
    ),
  ];
}

export async function loadBeaconBriefSettings(
  admin: SupabaseClient<Database>,
): Promise<BeaconBriefSettings> {
  const { data, error } = await admin
    .from("beacon_settings")
    .select("key, value")
    .eq("category", "beacon_brief");

  if (error || !data) return { ...BEACON_BRIEF_DEFAULTS };

  const map = new Map<string, unknown>();
  for (const row of data) map.set(row.key, row.value);

  const d = BEACON_BRIEF_DEFAULTS;
  return {
    enabled: asBool(map.get("bb_enabled"), d.enabled),
    discordEnabled: asBool(map.get("bb_discord_enabled"), d.discordEnabled),
    webSearchEnabled: asBool(
      map.get("bb_web_search_enabled"),
      d.webSearchEnabled,
    ),
    researchMaxSearches: asNum(
      map.get("bb_research_max_searches"),
      d.researchMaxSearches,
    ),
    researchGateEnabled: asBool(
      map.get("bb_research_gate_enabled"),
      d.researchGateEnabled,
    ),
    researchGateMinPostChars: asNum(
      map.get("bb_research_gate_min_post_chars"),
      d.researchGateMinPostChars,
    ),
    researchDomains: parseDomainList(map.get("bb_research_domains")),
    autopublish: asBool(map.get("bb_autopublish"), d.autopublish),
    contextThreshold: asNum(
      map.get("bb_context_threshold"),
      d.contextThreshold,
    ),
    followupLookbackHours: asNum(
      map.get("bb_followup_lookback_hours"),
      d.followupLookbackHours,
    ),
    mergeBlockRelevanceTier: asNum(
      map.get("bb_merge_block_relevance_tier"),
      d.mergeBlockRelevanceTier,
    ),
    eventKeyWindowHours: asNum(
      map.get("bb_event_key_window_hours"),
      d.eventKeyWindowHours,
    ),
    mergeGateEnabled: asBool(
      map.get("bb_merge_gate_enabled"),
      d.mergeGateEnabled,
    ),
    playerArticleCapPerDay: asNum(
      map.get("bb_player_article_cap_per_day"),
      d.playerArticleCapPerDay,
    ),
    modelMergeRewrite: asStr(
      map.get("bb_model_merge_rewrite"),
      d.modelMergeRewrite,
    ),
    patchMaxAgeMinutes: asNum(
      map.get("bb_patch_max_age_minutes"),
      d.patchMaxAgeMinutes,
    ),
    queueMaxAttempts: asNum(
      map.get("bb_queue_max_attempts"),
      d.queueMaxAttempts,
    ),
    discordJobsPerRun: asNum(
      map.get("bb_discord_jobs_per_run"),
      d.discordJobsPerRun,
    ),
    articleJobsPerRun: asNum(
      map.get("bb_article_jobs_per_run"),
      d.articleJobsPerRun,
    ),
    backfillCount: asNum(map.get("bb_backfill_count"), d.backfillCount),
    maxItemsPerRun: asNum(map.get("bb_max_items_per_run"), d.maxItemsPerRun),
    maxPostAgeMinutes: asNum(
      map.get("bb_max_post_age_minutes"),
      d.maxPostAgeMinutes,
    ),
    workerMaxRuntimeMs: asNum(
      map.get("bb_worker_max_runtime_ms"),
      d.workerMaxRuntimeMs,
    ),
    staleProcessingMinutes: asNum(
      map.get("bb_stale_processing_minutes"),
      d.staleProcessingMinutes,
    ),
    discordPaceMs: asNum(map.get("bb_discord_pace_ms"), d.discordPaceMs),
    matchSimilarityThreshold: asNum(
      map.get("bb_match_similarity_threshold"),
      d.matchSimilarityThreshold,
    ),
    matchCandidateLimit: asNum(
      map.get("bb_match_candidate_limit"),
      d.matchCandidateLimit,
    ),
    deletionWatchDays: asNum(
      map.get("bb_deletion_watch_days"),
      d.deletionWatchDays,
    ),
    deletionCheckHours: parseCheckSchedule(
      map.get("bb_deletion_check_hours"),
      d.deletionCheckHours,
    ),
    deletionSweepIntervalMinutes: asNum(
      map.get("bb_deletion_sweep_interval_minutes"),
      d.deletionSweepIntervalMinutes,
    ),
    deletionSweepMaxIds: asNum(
      map.get("bb_deletion_sweep_max_ids"),
      d.deletionSweepMaxIds,
    ),
    xProbeIntervalMinutes: asNum(
      map.get("bb_x_probe_interval_minutes"),
      d.xProbeIntervalMinutes,
    ),
    alertCooldownMinutes: asNum(
      map.get("bb_alert_cooldown_minutes"),
      d.alertCooldownMinutes,
    ),
    promptCacheEnabled: asBool(
      map.get("bb_prompt_cache_enabled"),
      d.promptCacheEnabled,
    ),
    keywordFilterEnabled: asBool(
      map.get("bb_keyword_filter_enabled"),
      d.keywordFilterEnabled,
    ),
    keywordFilter: asStr(map.get("bb_keyword_filter"), d.keywordFilter),
    nonFootballFilterEnabled: asBool(
      map.get("bb_non_football_filter_enabled"),
      d.nonFootballFilterEnabled,
    ),
    relevanceFilterEnabled: asBool(
      map.get("bb_relevance_filter_enabled"),
      d.relevanceFilterEnabled,
    ),
    relevanceThreshold: asNum(
      map.get("bb_relevance_threshold"),
      d.relevanceThreshold,
    ),
    modelArticle: asStr(map.get("bb_model_article"), d.modelArticle),
    modelResearch: asStr(map.get("bb_model_research"), d.modelResearch),
    modelTriage: asStr(map.get("bb_model_triage"), d.modelTriage),
    webhookId: asStr(map.get("bb_webhook_id"), d.webhookId),
    prompts: {
      categorize: asStr(map.get("bb_categorize_prompt"), d.prompts.categorize),
      researchGate: asStr(
        map.get("bb_research_gate_prompt"),
        d.prompts.researchGate,
      ),
      articleResearch: asStr(
        map.get("bb_article_research_prompt"),
        d.prompts.articleResearch,
      ),
      article: asStr(map.get("bb_article_prompt"), d.prompts.article),
      revisionRewrite: asStr(
        map.get("bb_revision_rewrite_prompt"),
        d.prompts.revisionRewrite,
      ),
      followupLink: asStr(
        map.get("bb_followup_link_prompt"),
        d.prompts.followupLink,
      ),
      mergeGate: asStr(map.get("bb_merge_gate_prompt"), d.prompts.mergeGate),
    },
  };
}
