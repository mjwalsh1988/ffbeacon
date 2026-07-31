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
   */
  researchMaxSearches: number;
  autopublish: boolean;
  contextThreshold: number;
  followupLookbackDays: number;
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
  modelTriage: string;
  webhookId: string;
  prompts: {
    categorize: string;
    articleResearch: string;
    article: string;
    revisionTriage: string;
    revisionRewrite: string;
    followupLink: string;
  };
}

export const BEACON_BRIEF_DEFAULTS: BeaconBriefSettings = {
  enabled: true,
  discordEnabled: true,
  webSearchEnabled: true,
  researchMaxSearches: 3,
  autopublish: true,
  contextThreshold: 1,
  followupLookbackDays: 3,
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
  modelTriage: "claude-haiku-4-5",
  webhookId: "",
  prompts: {
    categorize: "",
    articleResearch: "",
    article: "",
    revisionTriage: "",
    revisionRewrite: "",
    followupLink: "",
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
    autopublish: asBool(map.get("bb_autopublish"), d.autopublish),
    contextThreshold: asNum(
      map.get("bb_context_threshold"),
      d.contextThreshold,
    ),
    followupLookbackDays: asNum(
      map.get("bb_followup_lookback_days"),
      d.followupLookbackDays,
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
    modelTriage: asStr(map.get("bb_model_triage"), d.modelTriage),
    webhookId: asStr(map.get("bb_webhook_id"), d.webhookId),
    prompts: {
      categorize: asStr(map.get("bb_categorize_prompt"), d.prompts.categorize),
      articleResearch: asStr(
        map.get("bb_article_research_prompt"),
        d.prompts.articleResearch,
      ),
      article: asStr(map.get("bb_article_prompt"), d.prompts.article),
      revisionTriage: asStr(
        map.get("bb_revision_triage_prompt"),
        d.prompts.revisionTriage,
      ),
      revisionRewrite: asStr(
        map.get("bb_revision_rewrite_prompt"),
        d.prompts.revisionRewrite,
      ),
      followupLink: asStr(
        map.get("bb_followup_link_prompt"),
        d.prompts.followupLink,
      ),
    },
  };
}
