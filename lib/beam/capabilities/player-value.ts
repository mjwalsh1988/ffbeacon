/**
 * "What is Bijan Robinson worth?"
 *
 * Reads the pre-calculated player_value_trends row for the reader's resolved
 * (format, source), which is the same row the rankings board and the player
 * profile render. Value is the most format-dependent number on the site: the
 * same player is worth wildly different amounts in dynasty superflex and
 * one-quarterback redraft, so the answer always names the format and the source
 * rather than presenting a bare figure.
 *
 * Trend movement is gated on show_trend_30d. That flag exists because a change
 * computed from three data points is noise, and quoting it as momentum would be
 * inventing a story out of a sparse series.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { int, ordinal } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech, positionNoun } from "@/lib/beam/answers/templates";
import { parseWith, playerLink, playerRefSchema } from "./shared";

const schema = z.object({ player: playerRefSchema });
type Params = z.infer<typeof schema>;

type Result = {
  value: number | null;
  change30d: number | null;
  change30dPct: number | null;
  showTrend30d: boolean;
  trend30d: string | null;
  overallRank: number | null;
  positionRank: number | null;
  tier: number | null;
  updatedAt: string | null;
};

export const playerValue: BeamCapability<Params, Result> = {
  id: "player.value",
  label: "Player value",
  description: "Current FF Beacon value and 30-day movement for one player.",
  playerScope: "current",
  declineMessage: "We do not hold a current value for that player.",
  matcher: {
    base: 0.4,
    required: ["player"],
    optional: [],
    heads: ["what is", "how good is"],
    playerCount: 1,
  },
  examples: [
    "What is Bijan Robinson worth?",
    "What is CeeDee Lamb's value?",
    "How much is Brock Bowers worth in dynasty?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx) {
    const empty: Result = {
      value: null,
      change30d: null,
      change30dPct: null,
      showTrend30d: false,
      trend30d: null,
      overallRank: null,
      positionRank: null,
      tier: null,
      updatedAt: null,
    };
    if (!ctx.formatConfigId || !ctx.sourceSlug) return empty;

    const [trendRes, rankRes] = await Promise.all([
      ctx.supabase
        .from("player_value_trends")
        .select(
          "current_value, change_30d, change_30d_pct, trend_30d, show_trend_30d, updated_at",
        )
        .eq("player_id", params.player.id)
        .eq("format_config_id", ctx.formatConfigId)
        .eq("source", ctx.sourceSlug)
        .maybeSingle(),
      ctx.supabase
        .from("rankings")
        .select("overall_rank, position_rank, tier, generated_at")
        .eq("player_id", params.player.id)
        .eq("format_config_id", ctx.formatConfigId)
        .eq("source", ctx.sourceSlug)
        .is("week", null)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const trend = trendRes.data;
    const rank = rankRes.data;

    return {
      value: numOrNull(trend?.current_value),
      change30d: numOrNull(trend?.change_30d),
      change30dPct: numOrNull(trend?.change_30d_pct),
      showTrend30d: Boolean(trend?.show_trend_30d),
      trend30d: trend?.trend_30d ?? null,
      overallRank: rank?.overall_rank ?? null,
      positionRank: rank?.position_rank ?? null,
      tier: rank?.tier ?? null,
      updatedAt: trend?.updated_at ?? null,
    };
  },

  present(result, params, ctx): BeamAnswer {
    const player = params.player;
    const caveats: string[] = [];

    let headline: string;
    if (result.value === null) {
      headline = `We do not hold a current value for ${player.name} in ${ctx.formatDisplay}.`;
    } else {
      const rankClause =
        result.positionRank !== null && player.position
          ? `, the ${ordinal(result.positionRank)} ${positionNoun(player.position)}`
          : result.overallRank !== null
            ? `, ${ordinal(result.overallRank)} overall`
            : "";
      headline = `${player.name} is worth ${int(result.value)}${rankClause} in ${ctx.formatDisplay}.`;
    }

    const facts: Array<{ label: string; value: string }> = [];
    if (result.value !== null) facts.push({ label: "Value", value: int(result.value) });
    if (result.overallRank !== null) {
      facts.push({ label: "Overall rank", value: ordinal(result.overallRank) });
    }
    if (result.positionRank !== null && player.position) {
      facts.push({
        label: `${player.position} rank`,
        value: ordinal(result.positionRank),
      });
    }
    if (result.tier !== null) facts.push({ label: "Tier", value: String(result.tier) });

    if (result.showTrend30d && result.change30d !== null) {
      const pctPart =
        result.change30dPct !== null
          ? ` (${Math.abs(result.change30dPct * 100).toFixed(1)}%)`
          : "";
      // Spoken as a direction, not a bare sign. Some screen reader and
      // punctuation-level combinations swallow a leading minus, which turns a
      // drop into a rise.
      const direction = result.change30d > 0 ? "up" : result.change30d < 0 ? "down" : "flat";
      const magnitude = Math.abs(Math.round(result.change30d)).toLocaleString("en-US");
      facts.push({
        label: "30-day change",
        value: direction === "flat" ? "No change" : `${direction} ${magnitude}${pctPart}`,
      });
    } else if (result.change30d !== null) {
      // The number exists but the series behind it is too thin to read as a
      // trend, so it is withheld rather than dressed up as momentum.
      caveats.push("We do not have enough recent history to call a 30-day trend yet.");
    }

    const context = buildContext({
      formatDisplay: ctx.formatDisplay,
      sourceDisplay: ctx.sourceDisplay,
      asOf: result.updatedAt,
    });

    return {
      headline,
      speech: buildSpeech({ headline, facts, caveats, context }),
      facts,
      context,
      links: [
        playerLink(player),
        { href: "/rankings", label: "Full rankings board" },
      ],
      caveats,
    };
  },
};

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
