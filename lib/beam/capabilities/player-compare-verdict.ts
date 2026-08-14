/**
 * "Who is better for dynasty, Garrett Wilson or Drake London?"
 *
 * BEAM does not have an opinion about players. Beacon Breakdown does, and it is
 * a measured one: a weighted composite over value, rank, age, production,
 * projections, reliability, and market movement, with a written verdict that
 * names the two categories that actually moved the result.
 *
 * So this capability writes no comparison logic. It makes the same three calls
 * the shareable Beacon Breakdown card makes, in the same order, and reads the
 * verdict out:
 *
 *   loadBreakdown        -> resolve format and source, load both players
 *   loadBreakdownExtras  -> projections, reliability, market
 *   assembleBreakdown    -> the composite, the takeaways, the verdict
 *
 * See app/api/og/breakdown/[a]/[b]/route.tsx, which is the same sequence for the
 * same reason. If BEAM computed its own verdict it would eventually disagree
 * with the tool, and two answers to one question is worse than one answer.
 *
 * THE LENS IS THE QUESTION. "for dynasty", "for a competitive team", and "this
 * week" are three different questions about the same two players, and the
 * Breakdown already models exactly that distinction. The interpreter maps the
 * wording to a lens; when nobody said, the answer states which lens it used
 * rather than pretending the question had only one reading.
 *
 * COST. This is BEAM's expensive capability, roughly half a second, because the
 * extras load is three more query waves. That is the price of the real verdict
 * instead of a cheaper different one.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import {
  EMPTY_EXTRAS,
  assembleBreakdown,
  loadBreakdown,
  mergeMarket,
} from "@/lib/beacon-breakdown";
import { loadBreakdownExtras } from "@/lib/breakdown/load-extras";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { LENSES, type LensId } from "@/lib/breakdown/types";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import { parseWith } from "./shared";

const schema = z.object({
  slugA: z.string().min(1).max(120),
  slugB: z.string().min(1).max(120),
  nameA: z.string().min(1).max(120),
  nameB: z.string().min(1).max(120),
  lens: z.enum(["dynasty", "win-now", "this-week"]),
  /** False when the reader never said which question they were asking. */
  lensWasStated: z.boolean(),
});

type Params = z.infer<typeof schema>;

type Result = {
  verdict: string;
  leaderName: string | null;
  aPct: number;
  bPct: number;
  aName: string;
  bName: string;
  label: string;
  takeaways: Array<{ label: string; detail: string }>;
  formatDisplay: string;
  sourceDisplay: string | null;
};

export const playerCompareVerdict: BeamCapability<Params, Result> = {
  id: "player.compare.verdict",
  label: "Which player is better",
  description: "A head-to-head verdict for two players, through Beacon Breakdown.",
  playerScope: "current",
  declineMessage:
    "We could not build a comparison for those two. One of them may not have current values.",
  matcher: {
    base: 0.5,
    required: ["player"],
    optional: ["lens"],
    // "who had more" is deliberately absent: it belongs to the stat comparison,
    // and sharing it would put the two readings within a hair of each other on
    // a question that is unambiguously about a number.
    heads: ["who is better"],
    playerCount: 2,
  },
  examples: [
    "Who is better for dynasty, Garrett Wilson or Drake London?",
    "Who should I draft in a redraft league, Amon-Ra St. Brown or James Cook?",
    "Who should a rebuilding team prefer, Bijan Robinson or Jahmyr Gibbs?",
    "Who is more valuable, Puka Nacua or Nico Collins?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    const lens = params.lens as LensId;

    // Format and source are passed explicitly rather than left to loadBreakdown's
    // own resolver. Two reasons: BEAM has already resolved them once for this
    // request and the answer must not silently use a different pair, and the
    // resolver's cookie fallback calls next/headers, which only exists inside a
    // request. Handing it the answer keeps this capability callable from a
    // script or a test.
    // The settings row depends on nothing loadBreakdown produces, so the two go
    // in one wave. Serializing them put a whole round trip on the critical path
    // of BEAM's slowest capability for no reason.
    const [lookup, pulseSettings] = await Promise.all([
      loadBreakdown(ctx.supabase, params.slugA, params.slugB, {
        lens,
        formatParam: ctx.formatSlug,
        sourceParam: ctx.sourceSlug ?? undefined,
      }),
      // Service-role only, and loadBreakdownExtras runs with the public client,
      // so it is read here and handed down. Same split the Breakdown page and
      // the OG route use.
      loadPowerPulseSettings(ctx.admin),
    ]);
    if (!lookup.ok) return null;

    const core = lookup.result;
    const context = core.context;

    const extras = await loadBreakdownExtras(
      ctx.supabase,
      [core.a, core.b].map((p) => ({
        id: p.id,
        position: p.position,
        team: p.team,
        injuryStatus: p.injuryStatus,
        overallRank: p.overallRank,
      })),
      {
        scoringKey: context.scoringKey,
        formatConfigId: context.formatConfigId,
        valueSource: context.sourceSlug,
        isDynasty: context.isDynasty,
        isSuperflex: context.isSuperflex,
        tePremiumPerReception: 0,
      },
      pulseSettings,
    );

    const result = assembleBreakdown({
      a: core.a,
      b: core.b,
      extrasA: mergeMarket(core.a, extras.get(core.a.id) ?? EMPTY_EXTRAS),
      extrasB: mergeMarket(core.b, extras.get(core.b.id) ?? EMPTY_EXTRAS),
      leagueA: null,
      leagueB: null,
      lens,
      valueIsBeacon: context.valueIsBeacon,
      context,
    });

    const leaderName =
      result.edge.leader === "a"
        ? result.a.name
        : result.edge.leader === "b"
          ? result.b.name
          : null;

    return {
      verdict: result.verdict,
      leaderName,
      aPct: result.edge.aPct,
      bPct: result.edge.bPct,
      aName: result.a.name,
      bName: result.b.name,
      label: result.edge.label,
      takeaways: result.takeaways
        .filter((t) => t.winner !== "na")
        .slice(0, 3)
        .map((t) => ({ label: t.label, detail: t.detail })),
      formatDisplay: context.formatDisplay,
      sourceDisplay: context.sourceDisplay,
    };
  },

  present(result, params): BeamAnswer {
    const lensMeta = LENSES.find((l) => l.id === params.lens);
    const lensLabel = lensMeta?.label ?? params.lens;

    const caveats: string[] = [];
    if (!params.lensWasStated) {
      // Silence here would be a hidden assumption. Dynasty and win-now routinely
      // disagree, and the reader deserves to know which question got answered,
      // including where the assumption came from: their own format setting.
      caveats.push(
        `You did not say which kind of league, so this is the ${lensLabel.toLowerCase()} read, following your ${result.formatDisplay} format. Ask again with "dynasty", "win now", or "this week" for a different one.`,
      );
    }

    const facts = [
      { label: result.aName, value: `${result.aPct}%` },
      { label: result.bName, value: `${result.bPct}%` },
      { label: "Lens", value: lensLabel },
    ];
    for (const takeaway of result.takeaways) {
      facts.push({ label: takeaway.label, value: takeaway.detail });
    }

    const context = buildContext({
      formatDisplay: result.formatDisplay,
      sourceDisplay: result.sourceDisplay,
      note: "Verdict from Beacon Breakdown.",
    });

    return {
      // The Breakdown's own sentence, verbatim. Rewriting it here would be a
      // second opinion wearing the first one's numbers.
      headline: result.verdict,
      speech: buildSpeech({
        headline: result.verdict,
        facts,
        caveats,
        context,
        maxFacts: facts.length,
      }),
      facts,
      context,
      links: [
        {
          href: `/tools/beacon-breakdown?a=${encodeURIComponent(params.slugA)}&b=${encodeURIComponent(params.slugB)}&lens=${encodeURIComponent(params.lens)}`,
          label: "Open the full breakdown",
        },
      ],
      caveats,
    };
  },
};
