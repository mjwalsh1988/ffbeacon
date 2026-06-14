# Handoff: FF Beacon Phase B7 (AI signal wiring)

Resume by starting a fresh session and saying "continue B7".

## Current clean state (nothing broken)
- `@anthropic-ai/sdk` installed (`^0.104.1`, in package.json dependencies). Additive only.
- `npm run typecheck` and `npm run build` pass. All B0-B6 work shipped.
- `source_registry.ffbeacon.is_active` = FALSE (do not flip; owner reviews all 9 formats first).
- AI is OFF: `beacon_settings.ai_enabled` = false, `beacon_signal_weights` row `ai_adjust` is_enabled = false.
- Latest migration applied: 0050. Next numbers: 0051, 0052.
- The whole board is computed across all 9 formats (5363 value rows, 180 picks, trends 10710 combos).

## Confirmed decisions (from the claude-api skill + owner)
- TypeScript project => use the OFFICIAL `@anthropic-ai/sdk` (NOT raw fetch). `import Anthropic from "@anthropic-ai/sdk"`; `new Anthropic()` reads ANTHROPIC_API_KEY from env (present in .env.local).
- Model: `claude-haiku-4-5` (exact alias, NO date suffix). Already the seeded default `ai_model` in beacon_settings. Haiku 4.5 does NOT support the `effort` param or `max` effort — do not send effort/thinking for Haiku; keep the call simple (max_tokens ~256).
- Strict JSON out: use `output_config: { format: { type: "json_schema", schema: {...} } }` on `messages.create` (Haiku 4.5 supports structured outputs), then JSON.parse the text block. Avoid zod (not installed) — raw json_schema with additionalProperties:false.
- OWNER REQUIREMENT (hard): every AI prompt must be visible + EDITABLE in the admin AI settings sub-page. Nothing hardcoded. Store the system prompt as `beacon_settings.ai_system_prompt` (category 'ai'); the engine reads it live and substitutes a `{bound}` placeholder with the live `ai_adjustment_bound`. Code default is only a fallback when the row is absent.

## Remaining B7 work (in order)

### 1. Migration 0051 — beacon_ai_cache
Cache AI responses by input-hash so re-runs / unchanged inputs never re-bill.
```
create table public.beacon_ai_cache (
  input_hash text primary key,
  player_id uuid,
  adjustment_pct numeric not null,
  confidence numeric not null,
  rationale text,
  model text not null,
  created_at timestamptz not null default now()
);
-- RLS: enable; service_role_all only. No client access.
```
Save supabase/migrations/0051_beacon_ai_cache.sql + apply via MCP. Regenerate lib/database.types.ts after (new table) so the producer is typed.

### 2. Migration 0052 — AI settings into beacon_settings (category 'ai')
All admin-editable on /admin/beacon/settings. Insert (on conflict do nothing):
- `ai_system_prompt` (value_type 'string', category 'ai', label "AI system prompt", description "Instructions sent to the model. {bound} is replaced with the AI adjustment bound at runtime.") — DEFAULT TEXT: conservative analyst prompt instructing STRICT JSON only `{"adjustment_pct": number, "confidence": number, "rationale": string}` with adjustment_pct in [-{bound}, {bound}], confidence 0..1, rationale <= 20 words, "be conservative; the market already prices most info."
- `ai_max_calls` (number, default 60) — per-run cap on live API calls (cost control).
- `ai_min_spread` (number, default 0.15) — candidate gate: normalized cross-source disagreement >= this.
- `ai_min_mover` (number, default 0.05) — candidate gate: abs(stat_performance adjustment) >= this.
(ai_enabled / ai_model / ai_adjustment_bound already exist from migration 0037.)

### 3. lib/beacon/signals/ai-adjust.ts (the producer)
- `export interface AiCandidate { playerId: string; payload: Record<string, unknown>; }`
- `export interface AiResult { adjustmentPct: number; confidence: number; rationale: string; cached: boolean; }`
- `export async function callClaudeForAdjustment(payload, { model, bound, systemPrompt }): Promise<{adjustment_pct,confidence,rationale}|null>` — single SDK call; system = systemPrompt.replace('{bound}', String(bound)); user content = JSON.stringify(payload); output_config json_schema; clamp adjustment_pct to [-bound,bound], confidence to [0,1]. Export so the smoke test calls it directly.
- `export async function gatherAiAdjustments(supabase, candidates, { model, bound, systemPrompt, maxCalls }): Promise<{ map: Map<string, AiResult>; calls: number }>` — hash each payload (node:crypto sha256 of JSON+model+bound), batch-check beacon_ai_cache (.in input_hash), for misses call Claude up to maxCalls, upsert cache, return map + calls.

### 4. Orchestrator wiring (lib/calculate-beacon-values.ts)
- After perf gather, before the format loop: if settings.aiEnabled AND ai_adjust weight is_enabled AND process.env.ANTHROPIC_API_KEY present:
  - Build candidates from the FLAGSHIP format (dynasty-ppr-sflex) skill players: gate by (normalized source spread >= ai_min_spread) OR (abs(perfByPlayer adjustmentPct) >= ai_min_mover), cap at ai_max_calls. Load player names for candidate ids (one query). Payload: name, position, consensus_value (flagship normalized), per-source raw values, source_spread, perf_adjustment_pct.
  - aiResultByPlayer = gatherAiAdjustments(...). Track aiCalls.
- In the SKILL emit (not K/DEF): append AI to adjustInputs alongside stat_performance:
  `{ adjustmentPct: ai.adjustmentPct, weight: aiWeight, confidence: ai.confidence }`, aiWeight = findWeight(weights,'ai_adjust',null).weight. extraMeta.ai_adjust = { adjustment_pct, confidence, rationale, cached }.
- Set beacon_value_runs.ai_calls (column exists). Add ai_calls to CalculateBeaconResult + return + finalize update.
- The global factor clamp [0.5,1.5] already bounds the combined (perf+ai) adjustment — verify, no extra clamp needed.

### 5. SettingField textarea (components/admin/setting-field.tsx)
Render a <textarea> instead of <input> when value_type==='string' AND (setting.key.includes('prompt') OR String(value).length > 60). Keep label/description/save/aria-live identical. Makes ai_system_prompt editable on /admin/beacon/settings (already groups under category 'ai').

### 6. Smoke test + leave OFF
- scripts/beacon-ai-smoke.ts: one sample candidate payload, read ai_system_prompt + ai_model + ai_adjustment_bound from beacon_settings, call callClaudeForAdjustment once, print parsed/clamped result. Add npm script "beacon:ai-smoke". Run ONCE (one Haiku call ~$0.0001) to prove integration + JSON parse + clamp + valid model id.
- Do NOT flip ai_enabled. Do NOT flip is_active. Leave both false.
- Typecheck + build must pass. Update progress.md (add B7 tasks) at the boundary.

## After B7
Owner reviews all 9 formats via /admin/beacon/rankings, tunes live (Recompute now), then authorizes the is_active flip + the recalculate-beacon cron goes live. Enable AI later to test effectiveness against the established non-AI baseline.
