/**
 * Manager Pulse: "How to deal with them" (docs/manager-pulse-plan.md 6.7).
 *
 * PURE. No Supabase, no fetch, no React, no `Date.now()`, and this is the
 * whole point of the module: NO LANGUAGE MODEL, EVER. Every sentence is a
 * fixed template citing a figure already present elsewhere in the report. A
 * null figure means the template does not fire. There is no free-text field
 * anywhere in this file, and there never should be one: a generated sentence
 * has no template id a reader can check against the numbers beside it.
 *
 * EVERY SENTENCE CARRIES ITS SAMPLE SIZE INLINE, IN THE TEXT
 *   Not only in `NarrativeSentence.sampleSize`. A reader following along by
 *   ear (this project's accessibility rule) hears the count as part of the
 *   sentence, not as a footnote landing somewhere else on the page.
 *
 * MANDATORY: A SCALE-DEPENDENT FIGURE NAMES ITS LEAGUE TYPE
 *   Every value-priced figure (a trade margin, an age lean) is a `PerTypeStat`
 *   and is never pooled across dynasty and redraft (section 6.0). A template
 *   that reports one of these therefore always says "in dynasty" or "in
 *   redraft" in the sentence itself, never leaving a reader to assume which
 *   game's value scale produced the number.
 *
 * COPY RULES (docs/manager-pulse-plan.md section 14, restated here because
 * this file is where they are enforced)
 *   - The shortest version of every string that still says the thing.
 *   - Plain words. "Pays up for" beats "exhibits a value premium on".
 *   - No em dash, no en dash, no curly quotes, no ellipsis character, no
 *     middle dot, no emoji. Straight ASCII punctuation only.
 *   - No negative parallelism ("not just X, it's Y"), no puffery, no
 *     rule-of-three cadence, no formulaic transitions.
 *   - Never a judgement where a number will do. "Half their moves land by
 *     week 4" beats "they lose interest".
 */

import type { ManagerNarrative, ManagerReport, NarrativeSentence } from "./types";
import type { ManagerPulseSettings } from "./default-settings";

/*
 * The word-choice thresholds live in `settings.wording` now, not here.
 *
 * They decide vocabulary rather than arithmetic: nothing they touch changes a
 * figure, they decide whether three trades a season reads as "trades a lot" and
 * whether a two percent margin is worth calling "pays up" or is just noise.
 * That makes them the MOST editable numbers in the feature rather than the
 * least, because they are the point where a measurement becomes a sentence
 * about a person. Every one is on /admin/manager-pulse.
 */

/* -------------------------------------------------------------------------- */
/* Small formatting helpers                                                   */
/* -------------------------------------------------------------------------- */

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A share (0.08) as a whole-number percent string ("8%"). */
function pct(share: number): string {
  return `${Math.round(Math.abs(share) * 100)}%`;
}

/** A rounds figure (0.83) as one decimal place ("0.8"). */
function rounds1(value: number): string {
  return Math.abs(value).toFixed(1);
}

/* -------------------------------------------------------------------------- */
/* Template definitions                                                       */
/* -------------------------------------------------------------------------- */

type Template = {
  templateId: string;
  /**
   * `w` is `settings.wording`, passed in rather than read from a module
   * constant so every threshold that decides a WORD stays admin-editable.
   */
  build: (
    report: ManagerReport,
    w: ManagerPulseSettings["wording"],
    settings: ManagerPulseSettings,
  ) => NarrativeSentence | null;
};

/**
 * `build` returns null exactly when the guard fails, so a template that
 * cannot fire never has to duplicate its condition between a guard function
 * and a text builder that could disagree with it.
 */
const TEMPLATES: Template[] = [
  {
    templateId: "trades_often",
    build: (report, w) => {
      const count = report.trading.tradeCount.all;
      const perSeason = report.trading.tradesPerSeason.all;
      if (count === null || perSeason === null) return null;
      if (count === 0 || perSeason < w.tradesOftenPerSeason) return null;
      return {
        templateId: "trades_often",
        text: `Trades a lot. ${plural(count, "trade")} in ${plural(report.identity.seasonsCovered, "season")}, about ${perSeason.toFixed(1)} a year.`,
        sampleSize: count,
      };
    },
  },
  {
    templateId: "trades_rarely",
    build: (report, w) => {
      const count = report.trading.tradeCount.all;
      const perSeason = report.trading.tradesPerSeason.all;
      if (count === null || perSeason === null) return null;
      if (count === 0 || perSeason > w.tradesRarePerSeason) return null;
      return {
        templateId: "trades_rarely",
        text: `Barely trades. ${plural(count, "trade")} in ${plural(report.identity.seasonsCovered, "season")}.`,
        sampleSize: count,
      };
    },
  },
  {
    templateId: "pays_up_dynasty",
    build: (report, w) => {
      const margin = report.trading.avgValueMargin.dynasty;
      const sample = report.trading.avgValueMarginSampleSize.dynasty;
      if (margin === null || sample === null || margin >= -w.marginDeadzone) return null;
      return {
        templateId: "pays_up_dynasty",
        text: `Pays up in dynasty. Gives up ${pct(margin)} more value than market, over ${plural(sample, "graded trade")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "gets_value_dynasty",
    build: (report, w) => {
      const margin = report.trading.avgValueMargin.dynasty;
      const sample = report.trading.avgValueMarginSampleSize.dynasty;
      if (margin === null || sample === null || margin <= w.marginDeadzone) return null;
      return {
        templateId: "gets_value_dynasty",
        text: `Gets value in dynasty. Comes out ${pct(margin)} ahead of market, over ${plural(sample, "graded trade")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "pays_up_redraft",
    build: (report, w) => {
      const margin = report.trading.avgValueMargin.redraft;
      const sample = report.trading.avgValueMarginSampleSize.redraft;
      if (margin === null || sample === null || margin >= -w.marginDeadzone) return null;
      return {
        templateId: "pays_up_redraft",
        text: `Pays up in redraft. Gives up ${pct(margin)} more value than market, over ${plural(sample, "graded trade")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "gets_value_redraft",
    build: (report, w) => {
      const margin = report.trading.avgValueMargin.redraft;
      const sample = report.trading.avgValueMarginSampleSize.redraft;
      if (margin === null || sample === null || margin <= w.marginDeadzone) return null;
      return {
        templateId: "gets_value_redraft",
        text: `Gets value in redraft. Comes out ${pct(margin)} ahead of market, over ${plural(sample, "graded trade")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "wont_trade_picks",
    // The only template that needs a SAMPLE floor as well as a wording
    // threshold: "will not trade picks" is a claim about an absence, and an
    // absence over two trades is not evidence of anything.
    build: (report, _w, settings) => {
      const picks = report.trading.picksTraded.dynasty;
      const count = report.trading.tradeCount.dynasty;
      const floor = settings.samples.minTradesForMargin;
      if (picks === null || count === null) return null;
      if (picks !== 0 || count < floor) return null;
      return {
        templateId: "wont_trade_picks",
        text: `Will not trade picks in dynasty. 0 picks moved in ${plural(count, "trade")}.`,
        sampleSize: count,
      };
    },
  },
  {
    templateId: "buys_young_dynasty",
    build: (report, w) => {
      const lean = report.trading.ageLean;
      const sample = report.trading.ageLeanSampleSize;
      if (lean === null || lean <= w.ageLeanDeadzone) return null;
      return {
        templateId: "buys_young_dynasty",
        text: `Buys young in dynasty. Net value flows toward younger players, over ${plural(sample, "trade")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "buys_production_dynasty",
    build: (report, w) => {
      const lean = report.trading.ageLean;
      const sample = report.trading.ageLeanSampleSize;
      if (lean === null || lean >= -w.ageLeanDeadzone) return null;
      return {
        templateId: "buys_production_dynasty",
        text: `Buys proven production in dynasty. Net value flows toward older players, over ${plural(sample, "trade")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "good_lineup",
    build: (report, w) => {
      const efficiency = report.rosterOps.lineupEfficiency.all;
      const sample = report.rosterOps.lineupEfficiencySampleSize.all;
      const totalSeasons = report.counts.leagueSeasons;
      if (efficiency === null || sample === null || sample === 0) return null;
      if (efficiency < w.lineupGood) return null;
      return {
        templateId: "good_lineup",
        text: `Sets a good lineup. ${pct(efficiency)} of available points, measured in ${sample} of ${plural(totalSeasons, "season")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "poor_lineup",
    build: (report, w) => {
      const efficiency = report.rosterOps.lineupEfficiency.all;
      const sample = report.rosterOps.lineupEfficiencySampleSize.all;
      const totalSeasons = report.counts.leagueSeasons;
      if (efficiency === null || sample === null || sample === 0) return null;
      if (efficiency >= w.lineupPoor) return null;
      return {
        templateId: "poor_lineup",
        text: `Leaves points on the bench. ${pct(efficiency)} of available points, measured in ${sample} of ${plural(totalSeasons, "season")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "drafts_early",
    build: (report, w) => {
      const reach = report.drafting.reachIndexRounds.all;
      const sample = report.drafting.reachIndexSampleSize.all;
      if (reach === null || sample === null || sample === 0) return null;
      if (reach < w.draftEarlyRounds) return null;
      return {
        templateId: "drafts_early",
        text: `Drafts early. Takes players about ${rounds1(reach)} rounds before the market, over ${plural(sample, "graded pick")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "front_loaded_moves",
    build: (report, w) => {
      const shape = report.rosterOps.moveShape.all;
      const totalSeasons = report.counts.leagueSeasons;
      if (shape !== "front-loaded" || totalSeasons === 0) return null;
      return {
        templateId: "front_loaded_moves",
        text: `Quiet after the early weeks. Most moves land in the first half of the season, over ${plural(totalSeasons, "league-season")}.`,
        sampleSize: totalSeasons,
      };
    },
  },
  {
    templateId: "wins",
    build: (report, w) => {
      const championships = report.results.championships.all;
      const sample = report.results.sampleSize.all;
      if (championships === null || sample === null || championships === 0) return null;
      return {
        templateId: "wins",
        text: `Wins. ${plural(championships, "title")} in ${plural(sample, "season")}.`,
        sampleSize: sample,
      };
    },
  },
  {
    templateId: "unlucky",
    build: (report, w) => {
      const pointsFor = report.results.pointsForRank.all;
      const pointsAgainst = report.results.pointsAgainstRank.all;
      const sample = report.results.sampleSize.all;
      if (pointsFor === null || pointsAgainst === null || sample === null) return null;
      if (pointsAgainst > w.unluckyPointsAgainstMax) return null;
      if (pointsFor < w.unluckyPointsForMin || pointsFor > w.unluckyPointsForMax) return null;
      return {
        templateId: "unlucky",
        text: `Unlucky. Middle of the table on points scored, worst in the league on points against, over ${plural(sample, "season")}.`,
        sampleSize: sample,
      };
    },
  },
];

/** Every template id this file can fire, in priority order. Exported for tests. */
export const NARRATIVE_TEMPLATE_IDS: readonly string[] = TEMPLATES.map((t) => t.templateId);

/**
 * Fires every template in priority order and caps the result at
 * `settings.display.narrativeSentencesMax`. Templates are independent: more
 * than one may legitimately fire (a manager can both pay up in dynasty and
 * set a good lineup), and the cap simply stops showing the lowest-priority
 * ones once the card is full, it never picks among tied templates.
 */
export function buildNarrative(
  report: ManagerReport,
  settings: ManagerPulseSettings,
): ManagerNarrative {
  const sentences: NarrativeSentence[] = [];
  for (const template of TEMPLATES) {
    if (sentences.length >= settings.display.narrativeSentencesMax) break;
    const sentence = template.build(report, settings.wording, settings);
    if (sentence) sentences.push(sentence);
  }
  return { sentences };
}
