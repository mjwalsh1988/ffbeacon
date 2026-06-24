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
  const request: Json = {
    model,
    system,
    user: userContent,
    schema: schema as Json,
  };

  try {
    const res = await client.messages.create({
      model,
      max_tokens: args.maxTokens ?? 2048,
      system,
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
}

/**
 * Web-search-grounded research pass. Returns the model's free-text notes (or null
 * on failure). Uses the web_search tool; no output_config (citations would 400
 * with structured outputs). Logged to the article_write stage.
 */
export async function runWebSearchResearch(
  args: ResearchArgs,
): Promise<string | null> {
  const { admin, model, system, userContent, ingestionId, sourceId } = args;
  const client = new Anthropic();
  const started = Date.now();
  const request: Json = {
    model,
    system,
    user: userContent,
    tool: "web_search_20260209",
  };

  try {
    const res = await client.messages.create({
      model,
      max_tokens: args.maxTokens ?? 2048,
      system,
      messages: [{ role: "user", content: userContent }],
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });
    const text = textOf(res);
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: text ? "info" : "warn",
      message: text ? "research ok" : "empty research response",
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
