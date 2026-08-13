/**
 * Server-side validation for the Beacon Steals model config.
 *
 * The admin form posts a whole settings document, and a bad value here does not
 * throw, it quietly changes what every published verdict says. So nothing from
 * the client is trusted: every field is bounded to a range where the model still
 * behaves, and the whole document has to parse before it is written.
 *
 * The cross-field checks at the bottom catch the configurations that parse fine
 * but produce nonsense: a market depth that starts decaying after the deepest
 * player, a room-agreement band that inverts, a steal threshold above the
 * saturation point (which would make it impossible to ever be a steal).
 */

import { z } from "zod";
import { DEFAULT_DRAFT_VALUE_SETTINGS, type DraftValueSettings } from "./default-settings";

const unit = z.number().min(0).max(1);
const positive = z.number().min(0).max(1000);

export const draftValueSettingsSchema = z
  .object({
    modelVersion: z.string().min(1).max(32),

    leagueShape: z.object({
      teams: z.number().int().min(4).max(32),
      starters: z.object({
        QB: z.number().min(0).max(4),
        RB: z.number().min(0).max(6),
        WR: z.number().min(0).max(8),
        TE: z.number().min(0).max(4),
      }),
      flex: z.number().min(0).max(6),
      superflexAddsQb: z.boolean(),
      flexShare: z.object({
        RB: unit,
        WR: unit,
        TE: unit,
      }),
    }),

    blend: z.object({
      redraft: z.object({ value: unit, points: unit }),
      dynasty: z.object({ value: unit, points: unit }),
    }),

    reliability: z.object({
      enabled: z.boolean(),
      minMultiplier: z.number().min(0.1).max(3),
      maxMultiplier: z.number().min(0.1).max(3),
    }),

    availability: z.object({
      enabled: z.boolean(),
      damping: unit,
      minMultiplier: z.number().min(0.1).max(1),
    }),

    confidence: z.object({
      marketTrustedDepth: z.number().int().min(10).max(1000),
      marketFloor: unit,
      valueTrustedDepth: z.number().int().min(10).max(2000),
      valueFloor: unit,
      bothDataFactor: unit,
      projectionOnlyFactor: unit,
      noCompetitiveFactor: unit,
      roomMinDrafts: z.number().int().min(1).max(500),
      roomAgreementMax: z.number().min(1).max(2),
      roomAgreementMin: z.number().min(0.1).max(1),
      roomAgreementRounds: z.number().min(0.1).max(20),
      minConfidence: unit,
    }),

    positionCentering: z.object({
      enabled: z.boolean(),
      minPlayers: z.number().int().min(1).max(200),
    }),

    scoring: z.object({
      stealSaturationRounds: z.number().min(0.1).max(20),
      stealMinRounds: positive,
      fadeMinRounds: positive,
      swingMinRounds: positive,
      lateRoundPick: z.number().int().min(1).max(600),
    }),

    formats: z.object({
      include: z.array(z.string().min(1).max(64)).max(50),
      exclude: z.array(z.string().min(1).max(64)).max(50),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.reliability.minMultiplier > value.reliability.maxMultiplier) {
      ctx.addIssue({
        code: "custom",
        message: "Reliability minimum cannot be above its maximum.",
        path: ["reliability", "minMultiplier"],
      });
    }

    if (value.confidence.roomAgreementMin > value.confidence.roomAgreementMax) {
      ctx.addIssue({
        code: "custom",
        message: "Room agreement minimum cannot be above its maximum.",
        path: ["confidence", "roomAgreementMin"],
      });
    }

    // A trusted depth beyond every ranked player means confidence never decays,
    // which switches off the guard against deep-board noise entirely.
    if (value.confidence.marketTrustedDepth > value.confidence.valueTrustedDepth * 4) {
      ctx.addIssue({
        code: "custom",
        message:
          "Market trusted depth is far beyond the value depth, which effectively disables the confidence decay.",
        path: ["confidence", "marketTrustedDepth"],
      });
    }

    // A steal threshold at or above saturation makes the top category
    // unreachable: nothing would ever qualify.
    if (value.scoring.stealMinRounds > value.scoring.stealSaturationRounds) {
      ctx.addIssue({
        code: "custom",
        message: "Steal threshold cannot be above the saturation point, or nothing can qualify.",
        path: ["scoring", "stealMinRounds"],
      });
    }

    if (value.scoring.swingMinRounds > value.scoring.stealMinRounds) {
      ctx.addIssue({
        code: "custom",
        message: "A swing threshold above the steal threshold makes the swing bucket unreachable.",
        path: ["scoring", "swingMinRounds"],
      });
    }

    for (const key of ["redraft", "dynasty"] as const) {
      const pair = value.blend[key];
      if (pair.value + pair.points <= 0) {
        ctx.addIssue({
          code: "custom",
          message: `The ${key} blend cannot be all zeroes.`,
          path: ["blend", key, "value"],
        });
      }
    }

    const shares =
      value.leagueShape.flexShare.RB +
      value.leagueShape.flexShare.WR +
      value.leagueShape.flexShare.TE;
    if (shares > 1.001) {
      ctx.addIssue({
        code: "custom",
        message: "Flex shares cannot add up to more than one whole flex slot.",
        path: ["leagueShape", "flexShare", "RB"],
      });
    }
  });

export type ValidateResult =
  | { ok: true; settings: DraftValueSettings }
  | { ok: false; error: string };

export function validateDraftValueSettings(raw: unknown): ValidateResult {
  const parsed = draftValueSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") || "settings";
    return { ok: false, error: `${path}: ${first?.message ?? "invalid value"}` };
  }
  return { ok: true, settings: parsed.data as DraftValueSettings };
}

export { DEFAULT_DRAFT_VALUE_SETTINGS };
