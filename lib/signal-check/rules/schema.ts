/**
 * Signal Check rule + input schemas (Zod).
 *
 * Every rule's condition/action JSON and every public/admin input is validated
 * against these strict schemas before it is trusted. Unknown keys are rejected
 * (.strict()) so a malformed or hostile payload cannot smuggle fields past the
 * interpreter. The interpreter (interpreter.ts) only ever switches over the
 * enumerated `type` values defined here. There is NO eval, Function, or
 * free-form expression string anywhere in the rules layer.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Asset input (what the builder submits / a saved analysis replays)
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid();

export const playerAssetSchema = z
  .object({
    kind: z.literal("player"),
    playerId: uuidSchema,
  })
  .strict();

export const pickAssetSchema = z
  .object({
    kind: z.literal("pick"),
    season: z.number().int().min(2000).max(2100),
    round: z.number().int().min(1).max(10),
    pickPosition: z.enum(["early", "mid", "late"]).optional(),
    // Provenance only: it changes the wording shown next to the pick and the
    // confidence, never the value. The builder never sends it.
    slotEstimated: z.boolean().optional(),
  })
  .strict();

export const assetInputSchema = z.discriminatedUnion("kind", [
  playerAssetSchema,
  pickAssetSchema,
]);

export const sidesInputSchema = z
  .object({
    a: z.array(assetInputSchema),
    b: z.array(assetInputSchema),
  })
  .strict();

export const analysisInputSchema = z
  .object({
    formatSlug: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/, "invalid format slug"),
    sides: sidesInputSchema,
  })
  .strict();

export type AnalysisInputParsed = z.infer<typeof analysisInputSchema>;

// ---------------------------------------------------------------------------
// Rule condition (all present filters must pass for the rule to match)
// ---------------------------------------------------------------------------

export const ruleConditionSchema = z
  .object({
    positions: z.array(z.string().max(8)).max(12).optional(),
    formats: z.array(z.string().max(64)).max(32).optional(),
    assetKinds: z.array(z.enum(["player", "pick"])).max(2).optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    pickRounds: z.array(z.number().int().min(1).max(10)).max(10).optional(),
    pickSeasons: z.array(z.number().int().min(2000).max(2100)).max(10).optional(),
    minAssetCount: z.number().int().min(0).max(50).optional(),
    maxAssetCount: z.number().int().min(0).max(50).optional(),
    minSideTotal: z.number().optional(),
    maxSideTotal: z.number().optional(),
    // Best-asset share is a fraction 0..1 of a side's total.
    minBestAssetShare: z.number().min(0).max(1).optional(),
    maxBestAssetShare: z.number().min(0).max(1).optional(),
    tradeShape: z.array(z.string().max(40)).max(20).optional(),
  })
  .strict();

export type RuleConditionParsed = z.infer<typeof ruleConditionSchema>;

// ---------------------------------------------------------------------------
// Rule action (exactly one effect per rule, discriminated by type)
// ---------------------------------------------------------------------------

export const ruleActionSchema = z.discriminatedUnion("type", [
  // Asset-level (single_asset scope, post_format_calibration phase)
  z.object({ type: z.literal("multiply_pct"), value: z.number().min(-95).max(300) }).strict(),
  z.object({ type: z.literal("add_points"), value: z.number().min(-100000).max(100000) }).strict(),
  z.object({ type: z.literal("cap_value"), value: z.number().min(0).max(1000000) }).strict(),
  // Side-level (one_side scope, post_aggregation_trade_shape phase)
  z.object({ type: z.literal("side_penalty_pct"), value: z.number().min(0).max(95) }).strict(),
  z.object({ type: z.literal("side_boost_pct"), value: z.number().min(0).max(300) }).strict(),
  // Labeling / scoring (one_side or whole_trade)
  z.object({ type: z.literal("assign_shape"), value: z.string().max(40) }).strict(),
  z.object({ type: z.literal("confidence_modifier"), value: z.number().min(-100).max(100) }).strict(),
  z.object({ type: z.literal("trace_note") }).strict(),
]);

export type RuleActionParsed = z.infer<typeof ruleActionSchema>;

export const maxAdjustmentSchema = z
  .object({
    type: z.enum(["pct", "points"]),
    value: z.number().min(0).max(1000000),
  })
  .strict();

// ---------------------------------------------------------------------------
// Full rule row (admin create/update payload). The interpreter consumes this.
// ---------------------------------------------------------------------------

export const ruleScopeSchema = z.enum(["single_asset", "one_side", "whole_trade"]);
export const rulePhaseSchema = z.enum([
  "post_format_calibration",
  "post_aggregation_trade_shape",
]);

export const ruleInputSchema = z
  .object({
    scope: ruleScopeSchema,
    phase: rulePhaseSchema,
    sortOrder: z.number().int().min(0).max(100000).default(0),
    condition: ruleConditionSchema.default({}),
    action: ruleActionSchema,
    stackable: z.boolean().default(false),
    stackGroup: z.string().max(64).nullable().default(null),
    maxAdjustment: maxAdjustmentSchema.nullable().default(null),
    adminLabel: z.string().min(1).max(120),
    internalDescription: z.string().max(2000).nullable().default(null),
    publicExplanationTemplate: z.string().max(500).default(""),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((rule, ctx) => {
    // Enforce scope/phase/action coherence so an action can never run in a
    // phase it was not designed for.
    const assetActions = new Set(["multiply_pct", "add_points", "cap_value"]);
    const sideActions = new Set(["side_penalty_pct", "side_boost_pct"]);
    const t = rule.action.type;
    if (assetActions.has(t)) {
      if (rule.scope !== "single_asset" || rule.phase !== "post_format_calibration") {
        ctx.addIssue({
          code: "custom",
          message: `Action ${t} requires scope=single_asset and phase=post_format_calibration.`,
        });
      }
    }
    if (sideActions.has(t)) {
      if (rule.scope !== "one_side" || rule.phase !== "post_aggregation_trade_shape") {
        ctx.addIssue({
          code: "custom",
          message: `Action ${t} requires scope=one_side and phase=post_aggregation_trade_shape.`,
        });
      }
    }
    if (t === "assign_shape" && rule.phase !== "post_aggregation_trade_shape") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assign_shape must run in the post_aggregation_trade_shape phase.",
      });
    }
  });

export type RuleInputParsed = z.infer<typeof ruleInputSchema>;

/**
 * Parse a rule row loaded from the DB (jsonb condition/action) into a typed,
 * validated ParsedRule the interpreter can trust. Throws on invalid shape so a
 * corrupt row never silently mis-applies.
 */
export interface ParsedRule {
  id: string;
  rulesetVersion: number | null;
  scope: z.infer<typeof ruleScopeSchema>;
  phase: z.infer<typeof rulePhaseSchema>;
  sortOrder: number;
  condition: RuleConditionParsed;
  action: RuleActionParsed;
  stackable: boolean;
  stackGroup: string | null;
  maxAdjustment: z.infer<typeof maxAdjustmentSchema> | null;
  adminLabel: string;
  publicExplanationTemplate: string;
  enabled: boolean;
}

export const dbRuleSchema = z
  .object({
    id: z.string(),
    scope: ruleScopeSchema,
    phase: rulePhaseSchema,
    sort_order: z.number().int(),
    condition: ruleConditionSchema,
    action: ruleActionSchema,
    stackable: z.boolean(),
    stack_group: z.string().nullable(),
    max_adjustment: maxAdjustmentSchema.nullable(),
    admin_label: z.string(),
    public_explanation_template: z.string(),
    enabled: z.boolean(),
  })
  .strict();
