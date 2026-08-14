/**
 * "Where does Puka Nacua rank?"
 *
 * A rank is meaningless without the format it was computed in, so the answer
 * always names it. The read is the same rankings row every other surface uses,
 * for the reader's resolved (format, source).
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { ordinal } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech, rankSentence } from "@/lib/beam/answers/templates";
import { parseWith, playerLink, playerRefSchema } from "./shared";

const schema = z.object({ player: playerRefSchema });
type Params = z.infer<typeof schema>;

type Result = {
  overallRank: number | null;
  positionRank: number | null;
  tier: number | null;
  rankChange30d: number | null;
  showTrend30d: boolean;
  generatedAt: string | null;
};

export const playerRank: BeamCapability<Params, Result> = {
  id: "player.rank",
  label: "Player ranking",
  description: "Where one player sits in the rankings for the reader's format.",
  playerScope: "current",
  declineMessage: "We do not currently rank that player.",
  matcher: {
    base: 0.4,
    required: ["player"],
    optional: [],
    heads: ["where does", "what is"],
    playerCount: 1,
  },
  examples: [
    "Where does Puka Nacua rank?",
    "What is Brock Bowers ranked?",
    "Where does Bijan Robinson rank in dynasty?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx) {
    const empty: Result = {
      overallRank: null,
      positionRank: null,
      tier: null,
      rankChange30d: null,
      showTrend30d: false,
      generatedAt: null,
    };
    if (!ctx.formatConfigId || !ctx.sourceSlug) return empty;

    const [rankRes, trendRes] = await Promise.all([
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
      ctx.supabase
        .from("player_value_trends")
        .select("rank_change_30d, show_trend_30d")
        .eq("player_id", params.player.id)
        .eq("format_config_id", ctx.formatConfigId)
        .eq("source", ctx.sourceSlug)
        .maybeSingle(),
    ]);

    return {
      overallRank: rankRes.data?.overall_rank ?? null,
      positionRank: rankRes.data?.position_rank ?? null,
      tier: rankRes.data?.tier ?? null,
      rankChange30d: trendRes.data?.rank_change_30d ?? null,
      showTrend30d: Boolean(trendRes.data?.show_trend_30d),
      generatedAt: rankRes.data?.generated_at ?? null,
    };
  },

  present(result, params, ctx): BeamAnswer {
    const player = params.player;
    const headline = rankSentence(
      player.name,
      result.overallRank,
      result.positionRank,
      player.position,
      ctx.formatDisplay,
    );

    const facts: Array<{ label: string; value: string }> = [];
    if (result.overallRank !== null) {
      facts.push({ label: "Overall rank", value: ordinal(result.overallRank) });
    }
    if (result.positionRank !== null && player.position) {
      facts.push({ label: `${player.position} rank`, value: ordinal(result.positionRank) });
    }
    if (result.tier !== null) facts.push({ label: "Tier", value: String(result.tier) });
    if (result.showTrend30d && result.rankChange30d !== null && result.rankChange30d !== 0) {
      // A rank going DOWN in number is the player going up, so the label says
      // which direction is good rather than leaving a bare signed integer.
      const direction = result.rankChange30d < 0 ? "up" : "down";
      facts.push({
        label: "30-day move",
        value: `${Math.abs(result.rankChange30d)} spots ${direction}`,
      });
    }

    const context = buildContext({
      formatDisplay: ctx.formatDisplay,
      sourceDisplay: ctx.sourceDisplay,
      asOf: result.generatedAt,
    });

    return {
      headline,
      speech: buildSpeech({ headline, facts, caveats: [], context }),
      facts,
      context,
      links: [playerLink(player), { href: "/rankings", label: "Full rankings board" }],
      caveats: [],
    };
  },
};
