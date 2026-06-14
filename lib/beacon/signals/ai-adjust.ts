/**
 * ai_adjust producer (B7): an optional, bounded, per-player value ADJUSTMENT
 * sourced from an Anthropic model. Layered on the source_value base alongside
 * stat_performance, folded into the same bounded factor in the engine.
 *
 * Conservative + cost-guarded by design:
 *   - Only called for gated candidates (cross-source disagreement OR a sharp
 *     recent-form move), capped at ai_max_calls per run.
 *   - Every response is cached by input hash (payload + model + bound) in
 *     beacon_ai_cache, so unchanged inputs never re-bill the API.
 *   - adjustment_pct is hard-clamped to [-bound, bound]; confidence to [0, 1].
 *
 * NOTHING about the call is hardcoded: the system prompt, model, and bound all
 * come from beacon_settings (admin-editable on /admin/beacon/settings). The
 * {bound} placeholder in the prompt is substituted with the live bound here.
 * DEFAULT_AI_SYSTEM_PROMPT is only a fallback used when the DB row is absent.
 */

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { withRetry } from "../../supabase/retry";

/** Fallback only. The live prompt lives in beacon_settings.ai_system_prompt. */
export const DEFAULT_AI_SYSTEM_PROMPT =
  "You are a conservative fantasy football analyst assisting a dynasty and redraft value engine. You receive market data for one player as JSON: the consensus value, per-source raw values, cross-source disagreement, and a recent on-field performance signal. Return a small adjustment to the market value for that player. The market already prices in most public information, so be conservative and only move a value when the inputs strongly disagree with the consensus or recent performance is a clear outlier. Respond with STRICT JSON only, no prose and no code fences, matching exactly: {\"adjustment_pct\": number, \"confidence\": number, \"rationale\": string}. adjustment_pct must be between -{bound} and {bound} as a fraction (for example 0.05 means plus 5 percent). confidence must be between 0 and 1. rationale must be 20 words or fewer. When in doubt, return adjustment_pct 0 with low confidence.";

/** Strict JSON contract the model must satisfy (structured outputs). */
const ADJUSTMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["adjustment_pct", "confidence", "rationale"],
  properties: {
    adjustment_pct: { type: "number" },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
} as const;

export interface AiCandidate {
  playerId: string;
  payload: Record<string, unknown>;
}

export interface AiResult {
  adjustmentPct: number;
  confidence: number;
  rationale: string;
  cached: boolean;
}

export interface AiCallOptions {
  model: string;
  bound: number;
  systemPrompt: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Stable hash of a payload + model + bound. Same inputs => same cache key. */
export function hashCandidate(
  payload: Record<string, unknown>,
  model: string,
  bound: number,
): string {
  const basis = JSON.stringify({ payload, model, bound });
  return createHash("sha256").update(basis).digest("hex");
}

/**
 * Single Anthropic call for one player payload. Returns the parsed + clamped
 * adjustment, or null on any failure (API error, refusal, unparseable JSON) so
 * the engine simply skips the AI nudge for that player. Exported so the smoke
 * test can exercise the call path directly.
 *
 * Haiku 4.5 does not take an effort/thinking param, so the call stays simple:
 * a system prompt (with {bound} substituted), the JSON payload as the user
 * message, structured-output JSON schema, and a small max_tokens.
 */
export async function callClaudeForAdjustment(
  payload: Record<string, unknown>,
  { model, bound, systemPrompt }: AiCallOptions,
): Promise<{ adjustment_pct: number; confidence: number; rationale: string } | null> {
  const client = new Anthropic();
  const system = systemPrompt.replaceAll("{bound}", String(bound));

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      output_config: { format: { type: "json_schema", schema: ADJUSTMENT_SCHEMA } },
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as {
      adjustment_pct?: unknown;
      confidence?: unknown;
      rationale?: unknown;
    };
    const adjustment_pct = Number(parsed.adjustment_pct);
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(adjustment_pct) || !Number.isFinite(confidence)) return null;

    return {
      adjustment_pct: clamp(adjustment_pct, -bound, bound),
      confidence: clamp(confidence, 0, 1),
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return null;
  }
}

export interface GatherAiOptions extends AiCallOptions {
  maxCalls: number;
}

/**
 * Resolve AI adjustments for a set of candidates: batch-read the cache, call
 * Claude only for misses (up to maxCalls), upsert fresh results, and return a
 * map of playerId -> AiResult plus the live-call count. A null/failed call is
 * simply omitted from the map (no adjustment for that player). Cache hits never
 * count against maxCalls and never re-bill.
 */
export async function gatherAiAdjustments(
  supabase: SupabaseClient<Database>,
  candidates: AiCandidate[],
  { model, bound, systemPrompt, maxCalls }: GatherAiOptions,
): Promise<{ map: Map<string, AiResult>; calls: number }> {
  const map = new Map<string, AiResult>();
  if (candidates.length === 0) return { map, calls: 0 };

  const hashByPlayer = new Map<string, string>();
  for (const c of candidates) hashByPlayer.set(c.playerId, hashCandidate(c.payload, model, bound));
  const hashes = [...new Set(hashByPlayer.values())];

  // Batch-read existing cache rows.
  const cacheByHash = new Map<string, { adjustment_pct: number; confidence: number; rationale: string | null }>();
  const CHUNK = 200;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const slice = hashes.slice(i, i + CHUNK);
    const rows = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("beacon_ai_cache")
          .select("input_hash, adjustment_pct, confidence, rationale")
          .in("input_hash", slice);
        if (error) throw error;
        return data ?? [];
      },
      { label: "beacon_ai_cache read" },
    );
    for (const r of rows) {
      cacheByHash.set(r.input_hash, {
        adjustment_pct: Number(r.adjustment_pct),
        confidence: Number(r.confidence),
        rationale: r.rationale,
      });
    }
  }

  let calls = 0;
  const freshRows: Database["public"]["Tables"]["beacon_ai_cache"]["Insert"][] = [];

  for (const c of candidates) {
    const hash = hashByPlayer.get(c.playerId)!;
    const hit = cacheByHash.get(hash);
    if (hit) {
      map.set(c.playerId, {
        adjustmentPct: clamp(hit.adjustment_pct, -bound, bound),
        confidence: clamp(hit.confidence, 0, 1),
        rationale: hit.rationale ?? "",
        cached: true,
      });
      continue;
    }
    if (calls >= maxCalls) continue; // cost cap reached; no nudge for the rest

    const result = await callClaudeForAdjustment(c.payload, { model, bound, systemPrompt });
    calls += 1;
    if (!result) continue;

    map.set(c.playerId, {
      adjustmentPct: result.adjustment_pct,
      confidence: result.confidence,
      rationale: result.rationale,
      cached: false,
    });
    freshRows.push({
      input_hash: hash,
      player_id: c.playerId,
      adjustment_pct: result.adjustment_pct,
      confidence: result.confidence,
      rationale: result.rationale,
      model,
    });
  }

  if (freshRows.length > 0) {
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("beacon_ai_cache")
          .upsert(freshRows, { onConflict: "input_hash", ignoreDuplicates: false });
        if (error) throw error;
      },
      { label: "beacon_ai_cache upsert" },
    );
  }

  return { map, calls };
}
