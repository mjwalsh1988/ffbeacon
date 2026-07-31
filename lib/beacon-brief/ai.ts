/**
 * The Beacon Brief AI layer + shared event logger.
 *
 * Every Claude call goes through here so the EXACT prompt sent, the raw response,
 * the model, token usage, and duration land in beacon_brief_logs (powering the
 * admin Logs page and keeping prompts inspectable). Two call shapes:
 *   - runStructuredCall: strict JSON via output_config.format (categorize,
 *     article writing, triage, follow-up linking, rewrite).
 *   - runWebSearchResearch: a web-search-grounded research pass that returns
 *     free text. Kept separate because web search emits citations, which are
 *     incompatible with output_config.format in a single call.
 *
 * Calls never throw: any failure logs an error row and returns null so the
 * pipeline degrades gracefully.
 *
 * runStructuredCall marks the system prompt for prompt caching when the model
 * will actually cache a prompt that size. Repeat calls inside the 5-minute
 * window bill the prompt at roughly a tenth of the input rate. This changes
 * billing only: the model receives the same bytes and cannot answer
 * differently. Verify it is working on the admin Logs page, where token_usage
 * carries cache_read_input_tokens and cache_creation_input_tokens.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type BeaconLogStage =
  | "ingest"
  | "dedupe"
  | "revision_link"
  | "revision_triage"
  | "categorize"
  | "article_write"
  | "discord_post"
  | "discord_patch"
  | "deletion_check"
  | "error";

export interface BeaconLogEntry {
  stage: BeaconLogStage;
  level?: "info" | "warn" | "error";
  message?: string | null;
  ingestionId?: string | null;
  sourceId?: string | null;
  requestPayload?: Json | null;
  responsePayload?: Json | null;
  model?: string | null;
  tokenUsage?: Json | null;
  durationMs?: number | null;
}

/** Best-effort log write: never throws, never masks the caller's real outcome. */
export async function logBeaconBrief(
  admin: SupabaseClient<Database>,
  entry: BeaconLogEntry,
): Promise<void> {
  try {
    await admin.from("beacon_brief_logs").insert({
      stage: entry.stage,
      level: entry.level ?? "info",
      message: entry.message ?? null,
      ingestion_id: entry.ingestionId ?? null,
      source_id: entry.sourceId ?? null,
      request_payload: entry.requestPayload ?? null,
      response_payload: entry.responsePayload ?? null,
      model: entry.model ?? null,
      token_usage: entry.tokenUsage ?? null,
      duration_ms: entry.durationMs ?? null,
    });
  } catch (err) {
    console.warn(
      "[beacon-brief] log write failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Smallest prompt each model will cache, in tokens. Below the threshold the API
 * silently declines to cache: no error, just cache_creation_input_tokens = 0.
 *
 * The values are not monotonic across generations (Sonnet 4.6 caches from 1024,
 * the newer-sounding Haiku 4.5 needs 4096), so this cannot be guessed from the
 * model name. An unlisted model falls back to 1024, the most common threshold.
 * Being wrong is cheap in both directions: too low sends a marker the API
 * ignores, too high misses a caching opportunity. Neither changes the response.
 */
const PROMPT_CACHE_MIN_TOKENS: Array<[prefix: string, minTokens: number]> = [
  ["claude-opus-5", 512],
  ["claude-fable-5", 512],
  ["claude-opus-4-8", 1024],
  ["claude-sonnet-5", 1024],
  ["claude-sonnet-4-6", 1024],
  ["claude-sonnet-4-5", 1024],
  ["claude-opus-4-7", 2048],
  ["claude-opus-4-6", 4096],
  ["claude-opus-4-5", 4096],
  ["claude-haiku-4-5", 4096],
];
const DEFAULT_CACHE_MIN_TOKENS = 1024;

/**
 * Deliberately pessimistic characters-per-token ratio. These prompts measure
 * about 4.14 chars per token, so dividing by 4.5 UNDER-counts, which is the
 * safe direction: it keeps the marker off prompts that sit near the threshold
 * rather than claiming a cache that never forms.
 */
const CHARS_PER_TOKEN = 4.5;

/**
 * Whether a system prompt is worth marking for caching on this model.
 *
 * Caching is a prefix match and these calls send no tools, so the system prompt
 * IS the cacheable prefix and the per-call user content sits after it. That is
 * the ideal shape: the prompt is byte-identical on every call (it comes from
 * beacon_settings), and nothing volatile precedes it.
 */
export function shouldCacheSystemPrompt(model: string, system: string): boolean {
  const min =
    PROMPT_CACHE_MIN_TOKENS.find(([prefix]) => model.startsWith(prefix))?.[1] ??
    DEFAULT_CACHE_MIN_TOKENS;
  return system.length / CHARS_PER_TOKEN >= min;
}

interface StructuredArgs {
  admin: SupabaseClient<Database>;
  stage: BeaconLogStage;
  model: string;
  system: string;
  userContent: string;
  schema: Record<string, unknown>;
  ingestionId?: string | null;
  sourceId?: string | null;
  maxTokens?: number;
  /**
   * Mark the system prompt for prompt caching (default true). A cache read bills
   * at about a tenth of the input rate; a write costs 1.25x, so this pays off
   * only when calls cluster inside the 5-minute window. Article writes do: the
   * median gap between them is 12 seconds. Setting this false is the escape
   * hatch if that pattern ever changes; it cannot affect the model's output.
   */
  cacheSystem?: boolean;
}

/**
 * One strict-JSON Claude call. Returns the parsed object or null. Logs the exact
 * request and the raw response either way.
 */
export async function runStructuredCall<T>(
  args: StructuredArgs,
): Promise<T | null> {
  const {
    admin,
    stage,
    model,
    system,
    userContent,
    schema,
    ingestionId,
    sourceId,
  } = args;
  const client = new Anthropic();
  const started = Date.now();
  const cached =
    args.cacheSystem !== false && shouldCacheSystemPrompt(model, system);
  const request: Json = {
    model,
    system,
    user: userContent,
    schema: schema as Json,
    cached_system: cached,
  };

  try {
    const res = await client.messages.create({
      model,
      max_tokens: args.maxTokens ?? 2048,
      // Same prompt either way. The block form only adds the cache marker, so
      // the model sees byte-identical input and cannot respond differently.
      system: cached
        ? [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral" },
            },
          ]
        : system,
      messages: [{ role: "user", content: userContent }],
      output_config: { format: { type: "json_schema", schema } },
    });
    const text = textOf(res);
    const durationMs = Date.now() - started;

    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }

    await logBeaconBrief(admin, {
      stage,
      level: parsed ? "info" : "warn",
      message: parsed ? "ok" : "empty or unparseable response",
      ingestionId,
      sourceId,
      requestPayload: request,
      responsePayload: (text || null) as Json,
      model,
      tokenUsage: res.usage as unknown as Json,
      durationMs,
    });
    return parsed;
  } catch (err) {
    await logBeaconBrief(admin, {
      stage,
      level: "error",
      message: err instanceof Error ? err.message : "ai call failed",
      ingestionId,
      sourceId,
      requestPayload: request,
      model,
      durationMs: Date.now() - started,
    });
    return null;
  }
}

interface ResearchArgs {
  admin: SupabaseClient<Database>;
  model: string;
  system: string;
  userContent: string;
  ingestionId?: string | null;
  sourceId?: string | null;
  maxTokens?: number;
  /**
   * Cap on how many web searches the server-side loop may run. 0, negative, or
   * undefined means no cap (max_uses is omitted). See the note on the tool
   * declaration below for why an unbounded loop is expensive.
   */
  maxSearches?: number;
}

/**
 * Web-search-grounded research pass. Returns the model's free-text notes (or null
 * on failure). Uses the web_search tool; no output_config (citations would 400
 * with structured outputs). Logged to the article_write stage.
 *
 * COST: the web_search loop runs server side, and every round re-bills the whole
 * accumulated conversation (the post plus every prior search result). Input tokens
 * therefore grow with the SQUARE of the search count, so an uncapped loop is the
 * single most expensive thing in the pipeline. maxSearches (bb_research_max_searches)
 * bounds it. Raise it one step at a time and watch token_usage on the Logs page.
 */
export async function runWebSearchResearch(
  args: ResearchArgs,
): Promise<string | null> {
  const { admin, model, system, userContent, ingestionId, sourceId } = args;
  const client = new Anthropic();
  const started = Date.now();
  // Only a positive integer is a valid max_uses; anything else means "no cap".
  const searchCap =
    typeof args.maxSearches === "number" && args.maxSearches > 0
      ? Math.floor(args.maxSearches)
      : null;
  const request: Json = {
    model,
    system,
    user: userContent,
    tool: "web_search_20260209",
    max_uses: searchCap,
  };

  try {
    const res = await client.messages.create({
      model,
      max_tokens: args.maxTokens ?? 2048,
      system,
      messages: [{ role: "user", content: userContent }],
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          ...(searchCap !== null ? { max_uses: searchCap } : {}),
        },
      ],
    });
    const text = textOf(res);
    // stop_reason is the only signal that the loop was cut short rather than
    // finishing on its own: "pause_turn" means the server-side search loop hit its
    // iteration limit and these notes are partial. Surfaced so a cap set too low
    // shows up on the Logs page instead of silently thinning the research.
    const truncated = res.stop_reason === "pause_turn";
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: !text || truncated ? "warn" : "info",
      message: !text
        ? "empty research response"
        : truncated
          ? "research incomplete: search loop hit its limit (partial notes used)"
          : "research ok",
      ingestionId,
      sourceId,
      requestPayload: request,
      responsePayload: (text || null) as Json,
      model,
      tokenUsage: res.usage as unknown as Json,
      durationMs: Date.now() - started,
    });
    return text || null;
  } catch (err) {
    await logBeaconBrief(admin, {
      stage: "error",
      level: "error",
      message: err instanceof Error ? err.message : "research call failed",
      ingestionId,
      sourceId,
      requestPayload: request,
      model,
      durationMs: Date.now() - started,
    });
    return null;
  }
}
