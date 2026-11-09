/**
 * Puzzle generation (plan 6, 7 and 31.1).
 *
 * buildPuzzle is pure given an injected answers loader and pool, so it is unit
 * tested with fakes. generatePuzzle gathers the context, runs buildPuzzle,
 * tiers every chosen answer set and writes the puzzle and its prompts.
 * ensurePuzzle is the ONE inline generation path, called only by the attempt
 * route; a page render or /state never generates.
 *
 * Selection: shuffle the enabled families and walk them once. Each family
 * lists its parameterizations in seeded random order; the walk skips a draw
 * that ran in the last MEMORY_DAYS, a draw whose position the day already
 * asks about, and a family whose SOURCE the day already reads, and keeps the
 * first remaining draw whose typeable answer set falls inside the family's
 * bounds, loading at most MAX_TRIES_PER_FAMILY sets per family. Five
 * prompts are therefore five families, five sources and (where a prompt
 * names one) five positions. A family repeats only when fewer than five are
 * enabled. Short of five, the puzzle is written `short` with what passed;
 * zero passing prompts writes nothing. A set over its maximum is never
 * truncated: truncating would make a correct answer wrong.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { addDays } from "@/lib/game-date";
import { currentNflSeason } from "@/lib/nfl-season";
import { coalesce } from "@/lib/request-coalesce";
import { getActiveFormats, getAvailableSources, pickDefaultSource } from "@/lib/source";
import { findCompletedWeek, type CompletedWeekResult } from "./completed-week";
import { historyIdPool, historyReady, loadHistoryProminence, loadLinkedProminence } from "./history/answers";
import { mulberry32, seedFor, shuffle } from "./random";
import { chooseRateSeason, loadRosterRates } from "./rates";
import { intersectPool, longShotSearchPool } from "./search-pool";
import { loadLongShotSettings } from "./settings";
import { FAMILIES } from "./templates";
import type { GenerationContext, TemplateFamily, TemplateParams } from "./templates/types";
import { assignTiersBanded } from "./tiers";
import { STATS_FLOOR_SEASON, type AnswerEntry, type LongShotSettings, type TemplateKey } from "./types";

type Client = SupabaseClient<Database>;

export const PROMPTS_PER_DAY = 5;
/** Answer sets loaded per family per day before it is given up on. */
export const MAX_TRIES_PER_FAMILY = 4;
/** A template plus parameters that ran inside this many days is not asked again. */
export const MEMORY_DAYS = 21;
export const MODEL_VERSION = 2;

export type TryOutcome = "pass" | "too_few" | "too_many" | "skipped" | "recent" | "error";

export interface TryLog {
  template_key: TemplateKey;
  params: TemplateParams | null;
  answer_count: number | null;
  outcome: TryOutcome;
  detail?: string;
}

export interface CandidatePrompt {
  template_key: TemplateKey;
  prompt_text: string;
  params: TemplateParams;
  playerIds: string[];
}

export type AnswersLoader = (family: TemplateFamily, params: TemplateParams) => Promise<string[]>;

/** Pure: the memory key for a draw. Keys sorted, because jsonb reorders them. */
export function paramsKey(templateKey: string, params: TemplateParams): string {
  const sorted = Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]]));
  return `${templateKey}:${JSON.stringify(sorted)}`;
}

export async function buildPuzzle(
  ctx: GenerationContext,
  families: readonly TemplateFamily[],
  settings: LongShotSettings,
  rng: () => number,
  answersLoader: AnswersLoader,
  pool: ReadonlySet<string>,
): Promise<{ prompts: CandidatePrompt[]; log: TryLog[] }> {
  const enabled = families.filter((f) => settings.templates[f.key]?.enabled);
  const order = shuffle(enabled, rng);
  const usedSources = new Set<string>();
  const usedPositions = new Set<string>();
  // Draws that passed today, so the repeat pass cannot ask the same prompt twice.
  const usedKeys = new Set<string>();
  const prompts: CandidatePrompt[] = [];
  const log: TryLog[] = [];

  async function tryFamily(family: TemplateFamily): Promise<boolean> {
    if (usedSources.has(family.source)) {
      log.push({ template_key: family.key, params: null, answer_count: null, outcome: "skipped", detail: "source already asked" });
      return false;
    }
    const draws = family.draws(rng, ctx);
    if (draws.length === 0) {
      log.push({ template_key: family.key, params: null, answer_count: null, outcome: "skipped" });
      return false;
    }
    let tries = 0;
    for (const params of draws) {
      if (tries >= MAX_TRIES_PER_FAMILY) break;
      const key = paramsKey(family.key, params);
      if (usedKeys.has(key)) continue;
      if (ctx.recentKeys.has(key)) {
        log.push({ template_key: family.key, params, answer_count: null, outcome: "recent" });
        continue;
      }
      const position = family.position?.(params) ?? null;
      if (position && usedPositions.has(position)) continue;
      tries++;
      let ids: string[];
      try {
        ids = intersectPool(await answersLoader(family, params), pool);
      } catch (err) {
        log.push({
          template_key: family.key,
          params,
          answer_count: null,
          outcome: "error",
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const bounds = settings.templates[family.key];
      const outcome: TryOutcome =
        ids.length < bounds.min_answers ? "too_few" : ids.length > bounds.max_answers ? "too_many" : "pass";
      log.push({ template_key: family.key, params, answer_count: ids.length, outcome });
      if (outcome === "pass") {
        prompts.push({ template_key: family.key, prompt_text: family.text(params, ctx), params, playerIds: ids });
        usedKeys.add(key);
        usedSources.add(family.source);
        if (position) usedPositions.add(position);
        return true;
      }
    }
    return false;
  }

  for (const family of order) {
    if (prompts.length >= PROMPTS_PER_DAY) break;
    await tryFamily(family);
  }
  // Only a small enabled set may repeat a family, and then with fresh draws.
  if (prompts.length < PROMPTS_PER_DAY && enabled.length < PROMPTS_PER_DAY) {
    for (const family of order) {
      if (prompts.length >= PROMPTS_PER_DAY) break;
      usedSources.delete(family.source);
      await tryFamily(family);
    }
  }
  return { prompts, log };
}

export interface GenerateResult {
  ok: boolean;
  gameDate: string;
  puzzleId: string | null;
  status: "ready" | "short" | null;
  promptCount: number;
  /** False when another caller had already written this date. */
  created: boolean;
  completedWeek: CompletedWeekResult | null;
  rateSeason: number | null;
  rateZeroShare: number[];
  log: TryLog[];
  error?: string;
}

/** Every template plus parameters asked in the MEMORY_DAYS before the date. */
export async function loadRecentKeys(admin: Client, gameDate: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("long_shot_prompts")
    .select("template_key, params, long_shot_puzzles!inner(game_date)")
    .gte("long_shot_puzzles.game_date", addDays(gameDate, -MEMORY_DAYS))
    .lt("long_shot_puzzles.game_date", gameDate);
  if (error) throw new Error(`recent prompts read failed: ${error.message}`);
  return new Set((data ?? []).map((r) => paramsKey(r.template_key, (r.params ?? {}) as TemplateParams)));
}

/** Everything a generation reads before drawing. */
export async function loadGenerationContext(
  admin: Client,
  settings: LongShotSettings,
  gameDate: string,
  modernPool: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<{ ctx: GenerationContext; completed: CompletedWeekResult }> {
  const season = Number(currentNflSeason());
  const seasons: number[] = [];
  for (let s = STATS_FLOOR_SEASON; s <= season; s++) seasons.push(s);
  const [completed, sources, formats, rateSeason, ready, recentKeys] = await Promise.all([
    findCompletedWeek(admin, season),
    getAvailableSources(admin),
    getActiveFormats(admin),
    chooseRateSeason(admin, settings.tiers.min_rate_leagues),
    historyReady(admin),
    loadRecentKeys(admin, gameDate),
  ]);
  const defaultSlug = pickDefaultSource(sources);
  const def = sources.find((s) => s.slug === defaultSlug) ?? null;
  const ctx: GenerationContext = {
    season,
    seasons,
    completedWeek: completed.week,
    defaultSource: def ? { slug: def.slug, display: def.display_name } : null,
    defaultSourceFormats: def ? def.supported_format_slugs : null,
    formats: formats.map((f) => ({ id: f.id, slug: f.slug, display_name: f.display_name })),
    rateSeason,
    now,
    historyFloorSeason: settings.history.floor_season,
    historyReady: ready,
    recentKeys,
    modernPool,
  };
  return { ctx, completed };
}

/** Pure: tier every candidate (bands first) and report the share of rate-0 answers. */
export function tierCandidates(
  prompts: readonly CandidatePrompt[],
  rates: ReadonlyMap<string, number>,
  settings: LongShotSettings,
): { answers: AnswerEntry[][]; rateZeroShare: number[] } {
  const answers = prompts.map((p) =>
    assignTiersBanded(
      p.playerIds.map((id) => ({ player_id: id, rate: rates.get(id) ?? 0 })),
      settings.tiers.bands,
      settings.tiers.cutoffs,
    ),
  );
  const rateZeroShare = answers.map((set) =>
    set.length === 0 ? 0 : Math.round((set.filter((e) => e.rate === 0).length / set.length) * 1000) / 1000,
  );
  return { answers, rateZeroShare };
}

export interface PlannedPuzzle {
  prompts: CandidatePrompt[];
  answers: AnswerEntry[][];
  rateZeroShare: number[];
  log: TryLog[];
  ctx: GenerationContext;
  completed: CompletedWeekResult;
}

/** Everything up to the write. The dry-run script calls this and stops. */
export async function planPuzzle(
  admin: Client,
  gameDate: string,
  salt: number,
  settings: LongShotSettings,
  now: Date = new Date(),
): Promise<PlannedPuzzle> {
  const [modernPool, historyIds] = await Promise.all([longShotSearchPool(admin), historyIdPool(admin)]);
  const { ctx, completed } = await loadGenerationContext(admin, settings, gameDate, modernPool, now);
  // A history id is typeable because the search route returns it; see the id
  // rule in lib/long-shot/history/answers.ts.
  const pool = new Set<string>([...modernPool, ...historyIds]);
  const rng = mulberry32(seedFor(gameDate, salt));
  const { prompts, log } = await buildPuzzle(
    ctx,
    FAMILIES,
    settings,
    rng,
    (family, params) => family.answers(admin, params, ctx),
    pool,
  );
  const allIds = Array.from(new Set(prompts.flatMap((p) => p.playerIds)));
  const rates = await loadRosterRates(admin, ctx.rateSeason, allIds);
  // A historical answer's rate is its prominence; so is a modern-pool player's
  // when nobody rosters him or he has no team (retired since 2020), because a
  // roster rate of zero, or one stale league's, would make Gronkowski a Long
  // Shot.
  const unrated = allIds.filter((id) => !rates.has(id) && historyIds.has(id));
  for (const [id, p] of await loadHistoryProminence(admin, unrated)) rates.set(id, p);
  const thin = allIds.filter((id) => !historyIds.has(id) && (rates.get(id) ?? 0) < settings.tiers.bands.long_shot);
  for (const [id, linked] of await loadLinkedProminence(admin, thin)) {
    if (!linked.hasTeam || (rates.get(id) ?? 0) === 0) rates.set(id, linked.prominence);
  }
  const { answers, rateZeroShare } = tierCandidates(prompts, rates, settings);
  return { prompts, answers, rateZeroShare, log, ctx, completed };
}

async function readPuzzle(admin: Client, gameDate: string) {
  const { data, error } = await admin
    .from("long_shot_puzzles")
    .select("id, status, prompt_count")
    .eq("game_date", gameDate)
    .maybeSingle();
  if (error) throw new Error(`puzzle read failed: ${error.message}`);
  return data;
}

export async function generatePuzzle(
  admin: Client,
  gameDate: string,
  generatedBy: "cron" | "inline" | "admin",
  salt = 0,
  settingsArg?: LongShotSettings,
): Promise<GenerateResult> {
  const settings = settingsArg ?? (await loadLongShotSettings(admin));
  const plan = await planPuzzle(admin, gameDate, salt, settings);
  const base = {
    gameDate,
    completedWeek: plan.completed,
    rateSeason: plan.ctx.rateSeason,
    rateZeroShare: plan.rateZeroShare,
    log: plan.log,
  };
  if (plan.prompts.length === 0) {
    return { ...base, ok: false, puzzleId: null, status: null, promptCount: 0, created: false, error: "no_prompts" };
  }
  const status = plan.prompts.length < PROMPTS_PER_DAY ? "short" : "ready";
  // Puzzle and prompts land in one transaction (migration 0369), so no other
  // instance can read a puzzle without its prompts.
  const prompts = plan.prompts.map((p, i) => ({
    position: i + 1,
    template_key: p.template_key,
    prompt_text: p.prompt_text,
    params: p.params,
    answers: plan.answers[i],
    answer_count: plan.answers[i].length,
  }));
  const { data: puzzleId, error } = await admin.rpc("long_shot_insert_puzzle", {
    p_game_date: gameDate,
    p_status: status,
    p_prompt_count: plan.prompts.length,
    p_seed_salt: salt,
    p_generated_by: generatedBy,
    p_model_version: MODEL_VERSION,
    p_prompts: prompts as unknown as Json,
  });
  if (error) {
    if (error.code === "23505") {
      // Someone else generated this date first; theirs stands.
      const existing = await readPuzzle(admin, gameDate);
      return {
        ...base,
        ok: Boolean(existing),
        puzzleId: existing?.id ?? null,
        status: (existing?.status as "ready" | "short" | undefined) ?? null,
        promptCount: existing?.prompt_count ?? 0,
        created: false,
      };
    }
    throw new Error(`puzzle insert failed: ${error.message}`);
  }
  const inserted = { id: puzzleId as string };
  return {
    ...base,
    ok: true,
    puzzleId: inserted.id,
    status,
    promptCount: plan.prompts.length,
    created: true,
    ...(status === "short" ? { error: "short_puzzle" } : {}),
  };
}

/**
 * The puzzle for a date, generating it inline when missing. Coalesced per
 * date so concurrent starts share one generation. Returns null when no
 * prompt passed (the route answers 503 puzzle_unavailable).
 */
export async function ensurePuzzle(
  admin: Client,
  gameDate: string,
): Promise<{ id: string; status: "ready" | "short"; prompt_count: number } | null> {
  const existing = await readPuzzle(admin, gameDate);
  if (existing) return existing as { id: string; status: "ready" | "short"; prompt_count: number };
  return coalesce(`long-shot:generate:${gameDate}`, async () => {
    const again = await readPuzzle(admin, gameDate);
    if (again) return again as { id: string; status: "ready" | "short"; prompt_count: number };
    const result = await generatePuzzle(admin, gameDate, "inline", 0);
    if (!result.ok || !result.puzzleId || !result.status) return null;
    return { id: result.puzzleId, status: result.status, prompt_count: result.promptCount };
  });
}
