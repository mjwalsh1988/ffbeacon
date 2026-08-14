/**
 * Interpretation tests. Pure, no database.
 *
 * These cover the layer that has all the judgement in it: normalization, the
 * verb rule, entity extraction, and capability scoring. Player resolution and
 * the capabilities themselves need real rows and are covered by the smoke run
 * (npm run beam:smoke), which asks real questions against the real database.
 *
 * The most valuable case in here is the phrasing table: the plan promised that
 * five different ways of asking the same thing land on the same intent, and
 * that promise is the whole product. If it regresses, this file fails loudly.
 */

import { describe, expect, it } from "vitest";
import { normalizeName, normalizeText } from "./normalize";
import { extractEntities } from "./entities";
import { scoreCapabilities } from "./score";
import { CAPABILITIES } from "@/lib/beam/capabilities";
import { DEFAULT_BEAM_SETTINGS } from "@/lib/beam/default-settings";
import {
  BEAM_STATS,
  getStat,
  statForPosition,
} from "@/lib/beam/stats/registry";

const settings = DEFAULT_BEAM_SETTINGS;

/** The capability the scorer would try first. */
function topReading(question: string): string | null {
  const entities = extractEntities(question);
  const scored = scoreCapabilities(CAPABILITIES, entities, settings);
  const viable = scored.filter((c) => c.score >= settings.intent.acceptScore);
  return viable[0]?.capability.id ?? null;
}

describe("normalizeText", () => {
  it("lower-cases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeText("  How MANY yards?? ")).toBe("how many yards");
  });

  it("matches what players.search_name stores", () => {
    // These pairings are asserted against real values read from the database
    // during the build. If the generated column's definition ever changes, tier
    // 2 of the resolver silently stops firing, so they are pinned here.
    expect(normalizeName("A.J. Brown")).toBe("aj brown");
    expect(normalizeName("Ja'Marr Chase")).toBe("jamarr chase");
    expect(normalizeName("Amon-Ra St. Brown")).toBe("amonra st brown");
    expect(normalizeName("Tyree St. Louis")).toBe("tyree st louis");
  });

  it("folds accents to the base letter", () => {
    expect(normalizeText("André Dozier")).toBe("andre dozier");
  });

  it("strips a possessive but never a bare trailing s", () => {
    expect(normalizeText("Purdy's yards")).toBe("purdy yards");
    // Real surnames end in s, and stripping it would break every one of them.
    expect(normalizeText("Mark Andrews")).toBe("mark andrews");
  });

  it("expands a contraction typed without its apostrophe", () => {
    // How these are typed on a phone. Left alone, "whats" has no question head
    // in it and glues itself to the next word, so "whats ppr" went looking for a
    // glossary entry called "whats ppr".
    expect(normalizeText("whats ppr")).toBe("what is ppr");
    expect(normalizeText("whos brock purdy")).toBe("who is brock purdy");
    expect(normalizeText("hows gibbs doing")).toBe("how is gibbs doing");
    expect(normalizeText("wheres bijan going in drafts")).toBe(
      "where is bijan going in drafts",
    );
  });

  it("expands the contractions that carry question meaning", () => {
    expect(normalizeText("What's his value")).toBe("what is his value");
  });
});

describe("the verb rule", () => {
  it("reads a bare 'yards' plus a throwing verb as passing yards", () => {
    const e = extractEntities("how many yards did purdy throw for");
    expect(e.statIds).toContain("pass_yd");
  });

  it("reads a bare 'touchdowns' plus a throwing verb as passing touchdowns", () => {
    const e = extractEntities("how many touchdowns did allen throw for");
    expect(e.statIds).toContain("pass_td");
  });

  it("reads a bare 'yards' plus a running verb as rushing yards", () => {
    const e = extractEntities("how many yards did henry run for in 2023");
    expect(e.statIds).toContain("rush_yd");
  });

  it("reads a bare 'touchdowns' plus 'score' as total touchdowns", () => {
    const e = extractEntities("how many touchdowns did gibbs score last year");
    expect(e.statIds).toContain("total_td");
  });

  it("leaves an unqualified unit marked ambiguous", () => {
    const e = extractEntities("how many yards did gibbs have in 2025");
    expect(e.ambiguousUnit).toBe("yards");
    expect(e.ambiguousUnitSpan).not.toBeNull();
  });

  it("does not mark a fully qualified phrase ambiguous", () => {
    const e = extractEntities("how many rushing yards did gibbs have");
    expect(e.ambiguousUnit).toBeNull();
    expect(e.statIds).toEqual(["rush_yd"]);
  });
});

describe("longest-match phrase claiming", () => {
  it("prefers 'passing yards' over 'yards'", () => {
    expect(extractEntities("purdy passing yards").statIds).toEqual(["pass_yd"]);
  });

  it("prefers 'yards per carry' over both 'yards' and 'carry'", () => {
    expect(extractEntities("gibbs yards per carry 2025").statIds).toEqual([
      "rush_ypc",
    ]);
  });

  it("prefers 'points allowed' over a bare 'points' for a defense", () => {
    expect(extractEntities("ravens points allowed").statIds).toEqual([
      "pts_allow",
    ]);
  });
});

describe("season extraction", () => {
  it("reads a four-digit year", () => {
    expect(extractEntities("purdy passing yards 2024").seasons).toEqual([
      { kind: "explicit", season: 2024 },
    ]);
  });

  it("reads 'last year' as relative, not as a number", () => {
    expect(extractEntities("purdy passing yards last year").seasons).toEqual([
      { kind: "relative", offset: -1 },
    ]);
  });

  it("does not mistake a jersey number for a season", () => {
    // Two-digit years are only read inside a plausible recent range, so "12"
    // stays a plain token.
    expect(extractEntities("purdy 12 targets").seasons).toEqual([]);
  });

  it("reads 'this year' as the current season, resolved later", () => {
    expect(extractEntities("purdy yards this year").seasons).toEqual([
      { kind: "current" },
    ]);
  });
});

describe("capability routing", () => {
  it("routes the five plan phrasings to the same intent", () => {
    const phrasings = [
      "brock purdy passing yards 2025",
      "how many yards did purdy throw for",
      "how many pass yards did brock purdy have last year",
      "purdy passing yds",
      "what were brock purdys passing yards",
    ];
    for (const phrasing of phrasings) {
      expect(topReading(phrasing), phrasing).toBe("player.season.stat");
    }
  });

  it("routes a two-player statistic question to the comparison", () => {
    expect(
      topReading(
        "who had more receiving yards in 2025 ceedee lamb or garrett wilson",
      ),
    ).toBe("player.compare.stat");
  });

  it("routes a two-player judgement question to the verdict", () => {
    expect(
      topReading("who is better for dynasty garrett wilson or drake london"),
    ).toBe("player.compare.verdict");
  });

  it("routes a draft question between two players to the verdict", () => {
    // Every one of these failed before the draft vocabulary existed: "draft"
    // and "take" were unclaimed, so each became a one-word player name and the
    // question arrived with three or four subjects instead of two.
    const phrasings = [
      "who should i draft in a redraft league between amon ra st brown and james cook",
      "who should i draft between bijan robinson and jahmyr gibbs",
      "who would you draft ceedee lamb or puka nacua",
      "who should i take garrett wilson or drake london",
      "who should i pick bijan robinson or jahmyr gibbs",
    ];
    for (const phrasing of phrasings) {
      expect(topReading(phrasing), phrasing).toBe("player.compare.verdict");
    }
  });

  it("reads the league type in a draft question as the lens", () => {
    expect(
      extractEntities(
        "who should i draft in a redraft league amon ra or james cook",
      ).lens,
    ).toBe("win-now");
    expect(
      extractEntities(
        "who should i draft in my startup bijan robinson or jahmyr gibbs",
      ).lens,
    ).toBe("dynasty");
    // No league type stated. The interpreter fills this from the reader's own
    // format, so extraction must report that nobody said.
    expect(
      extractEntities("who should i draft bijan robinson or jahmyr gibbs").lens,
    ).toBeNull();
  });

  it("routes a value question to the value capability", () => {
    expect(topReading("what is bijan robinson worth")).toBe("player.value");
  });

  it("routes a rank question to the rank capability", () => {
    expect(topReading("where does puka nacua rank")).toBe("player.rank");
  });

  it("routes an age question to the bio capability", () => {
    expect(topReading("how old is brock purdy")).toBe("player.bio");
  });

  it("routes a whole-season question to the stat line", () => {
    expect(topReading("how did jahmyr gibbs do in 2025")).toBe(
      "player.stat.line",
    );
    // Present tense asks the same question. Without a head it landed on the
    // value capability, which answers something else entirely.
    expect(topReading("how is jahmyr gibbs doing in 2025")).toBe(
      "player.stat.line",
    );
  });

  it("leaves a short glossary question as one term and a head", () => {
    const e = extractEntities(normalizeText("whats ppr"));
    expect(e.heads).toContain("what is");
    expect(e.nameSpans.map((s) => s.text)).toEqual(["ppr"]);
  });

  it("disqualifies a comparison when only one player was named", () => {
    const entities = extractEntities("who is better brock purdy");
    const scored = scoreCapabilities(CAPABILITIES, entities, settings);
    expect(
      scored.some((c) => c.capability.id === "player.compare.verdict"),
    ).toBe(false);
  });

  it("disqualifies a stat question with no statistic in it", () => {
    const entities = extractEntities("brock purdy");
    const scored = scoreCapabilities(CAPABILITIES, entities, settings);
    expect(scored.some((c) => c.capability.id === "player.season.stat")).toBe(
      false,
    );
  });
});

describe("name spans", () => {
  it("leaves only the name after every vocabulary has claimed its words", () => {
    const e = extractEntities(
      "how many passing yards did brock purdy have in 2025",
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual(["brock purdy"]);
  });

  it("splits two players around a comparator", () => {
    const e = extractEntities(
      "who had more targets ceedee lamb or garrett wilson",
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual([
      "ceedee lamb",
      "garrett wilson",
    ]);
  });

  it("does not absorb a concept word into the name", () => {
    const e = extractEntities("what is bijan robinson worth");
    expect(e.nameSpans.map((s) => s.text)).toEqual(["bijan robinson"]);
    expect(e.concepts).toContain("value");
  });

  it("keeps a four-word name intact", () => {
    const e = extractEntities("amon ra st brown targets");
    expect(e.nameSpans.map((s) => s.text)).toEqual(["amon ra st brown"]);
  });

  it("splits two players joined by 'and' rather than a comparator", () => {
    // "and" is filler, not a comparator: it has to break the token run so two
    // names do not merge, without also claiming the question is a head-to-head.
    const e = extractEntities(
      "who should i draft between amon ra and james cook",
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual(["amon ra", "james cook"]);
    expect(e.hasComparator).toBe(false);
  });

  it("claims the league-shape words a draft question carries", () => {
    const e = extractEntities(
      "who should i draft in a redraft league amon ra or james cook",
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual(["amon ra", "james cook"]);
    expect(e.leftoverTokens).toEqual([]);
  });

  it("still reads 'drafted' as a biography word", () => {
    const e = extractEntities("where was brock purdy drafted");
    expect(e.concepts).toContain("bio");
    expect(e.nameSpans.map((s) => s.text)).toEqual(["brock purdy"]);
  });
});

describe("the stat registry", () => {
  it("has no unintended duplicate phrasings", () => {
    const KNOWN_SHARED = new Set<string>();
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const stat of BEAM_STATS) {
      for (const phrase of stat.phrasings) {
        if (KNOWN_SHARED.has(phrase)) continue;
        const existing = seen.get(phrase);
        if (existing && existing !== stat.id) {
          collisions.push(
            `"${phrase}" claimed by both ${existing} and ${stat.id}`,
          );
        }
        if (!existing) seen.set(phrase, stat.id);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("swaps a shared phrase to the right stat once the position is known", () => {
    // Total touchdowns for a defense means DEFENSIVE touchdowns, and the
    // skill-position reading has no rows for a DEF player.
    expect(statForPosition("total_td", "DEF")).toBe("def_td");
    expect(statForPosition("total_td", "RB")).toBe("total_td");
    expect(statForPosition("rush_yd", "RB")).toBe("rush_yd");
    expect(statForPosition("pass_int", null)).toBe("pass_int");
  });

  it("offers no stat we hold no data for", () => {
    // Two stats were removed after checking production: player_stats.interceptions
    // is 0 on every team-defense row, and target_share is null on all 283k rows.
    // A stat that can only ever answer zero is worse than one we do not offer.
    const ids = BEAM_STATS.map((s) => s.id) as string[];
    expect(ids).not.toContain("def_int");
    expect(ids).not.toContain("target_share");
  });

  it("gives every stat a resolvable label and format", () => {
    for (const stat of BEAM_STATS) {
      expect(getStat(stat.id).label.length).toBeGreaterThan(0);
      expect(stat.positions.length).toBeGreaterThan(0);
    }
  });

  it("only lets a stat resolve to positions it actually supports", () => {
    for (const stat of BEAM_STATS) {
      for (const position of stat.resolutionPositions ?? []) {
        expect(
          stat.positions,
          `${stat.id} resolution position ${position}`,
        ).toContain(position);
      }
    }
  });
});

describe("week ranges", () => {
  const range = (question: string) =>
    extractEntities(normalizeText(question)).weeks;

  it("reads every way people write a range", () => {
    expect(range("passing yards between weeks 2 and 8")).toMatchObject({
      start: 2,
      end: 8,
    });
    expect(range("passing yards from week 2 to week 8")).toMatchObject({
      start: 2,
      end: 8,
    });
    expect(range("passing yards weeks 2 through 9")).toMatchObject({
      start: 2,
      end: 9,
    });
    expect(range("passing yards in weeks 2-8")).toMatchObject({
      start: 2,
      end: 8,
    });
    expect(range("passing yards in week 5")).toMatchObject({
      start: 5,
      end: 5,
    });
  });

  it("claims week numbers before the season scan can read them as years", () => {
    // "15" and "17" are both in the range the season parser treats as a
    // two-digit year, so without the week pass running first this question is
    // about the 2015 and 2017 seasons.
    const e = extractEntities(
      normalizeText(
        "how many points did puka nacua score between weeks 15 and 17 last year",
      ),
    );
    expect(e.weeks).toMatchObject({ start: 15, end: 17 });
    expect(e.seasons).toEqual([{ kind: "relative", offset: -1 }]);
    expect(e.nameSpans.map((s) => s.text)).toEqual(["puka nacua"]);
  });

  it("keeps a hyphenated range intact through normalization", () => {
    // Hyphens are deleted between letters, so "2-8" used to normalize to "28",
    // a week that does not exist.
    expect(normalizeText("weeks 2-8")).toBe("weeks 2 8");
  });

  it("survives a typo in the word 'weeks'", () => {
    // The failure this guards is not "no range found". A misspelled keyword
    // became a name span, which made three subjects out of a two-player
    // question, and the leftover "17" was then read as the 2017 season. The
    // reader saw "BEAM can handle two players at a time" and no clue why.
    expect(range("receiving yards between weks 10 and 17")).toMatchObject({
      start: 10,
      end: 17,
    });
    expect(range("passing yards in wek 5")).toMatchObject({ start: 5, end: 5 });
    expect(range("passing yards in weeek 5")).toMatchObject({
      start: 5,
      end: 5,
    });

    const e = extractEntities(
      normalizeText(
        "how many receiving yards did marvin harrison and michael wilson have between weks 10 and 17 of last year",
      ),
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual([
      "marvin harrison",
      "michael wilson",
    ]);
    expect(e.seasons).toEqual([{ kind: "relative", offset: -1 }]);
  });

  it("does not read a word as a week just because it is close to one", () => {
    // The tolerance is guarded on a number following it, so a name or an
    // ordinary word can never be swallowed.
    expect(range("how many yards did wilson have in 2025")).toBeNull();
    expect(range("what is bijan robinson worth")).toBeNull();
    expect(
      range("how many carries did saquon barkley have in 2024"),
    ).toBeNull();
  });

  it("does not mistake the lens phrase 'this week' for a range", () => {
    const e = extractEntities(
      normalizeText("who is better this week ceedee lamb or puka nacua"),
    );
    expect(e.weeks).toBeNull();
    expect(e.lens).toBe("this-week");
  });

  it("does not swallow a name that follows a week number", () => {
    const e = extractEntities(
      normalizeText("how many yards did purdy have in week 5"),
    );
    expect(e.weeks).toMatchObject({ start: 5, end: 5 });
    expect(e.nameSpans.map((s) => s.text)).toEqual(["purdy"]);
  });

  it("routes a week-range question to the plain total, not the projection", () => {
    expect(
      topReading(
        "how many passing yards did brock purdy have last year between weeks 2 and 8",
      ),
    ).toBe("player.season.stat");
    expect(
      topReading(
        "how many receiving yards did marvin harrison and michael wilson each have between weeks 2 and 9 of last year",
      ),
    ).toBe("player.compare.stat");
  });

  it("routes only an explicit projection to the projection capability", () => {
    expect(
      topReading(
        "project the season total from weeks 2 through week 4 from last year for michael wilson",
      ),
    ).toBe("player.weeks.projection");
    expect(
      topReading("what pace was puka nacua on from weeks 1 to 6 in 2025"),
    ).toBe("player.weeks.projection");
  });

  it("disqualifies a projection with no week range in it", () => {
    // Nothing to project FROM. Falling back to the whole season would answer a
    // question the reader did not ask.
    const entities = extractEntities(
      normalizeText("project puka nacua for 2025"),
    );
    const scored = scoreCapabilities(CAPABILITIES, entities, settings);
    expect(
      scored.some((c) => c.capability.id === "player.weeks.projection"),
    ).toBe(false);
  });

  it("claims the words people use to describe a projection's input", () => {
    // "project tucker krafts season totals for last year by using his weeks 1
    // through 5" produced three name spans: the player, "totals", and "by
    // using". Three spans read as three players, and the reader was told the
    // question had too many people in it.
    const e = extractEntities(
      normalizeText(
        "project tucker krafts season totals for last year by using his weeks 1 through 5",
      ),
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual(["tucker krafts"]);
    expect(e.weeks).toMatchObject({ start: 1, end: 5 });
    expect(e.concepts).toContain("project");
  });

  it("claims 'each' and 'from' so neither becomes a player name", () => {
    const e = extractEntities(
      normalizeText(
        "how many receiving yards did marvin harrison and michael wilson each have from weeks 2 to 9",
      ),
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual([
      "marvin harrison",
      "michael wilson",
    ]);
  });
});

describe("projections and beat rates", () => {
  it("routes a beat-rate comparison ahead of the head-to-head verdict", () => {
    // Both fit, both clamp to 1.00, and the verdict would answer a different
    // question about the same two players with total confidence.
    expect(
      topReading(
        "who has the better projection beat rate over the last 3 years between james cook and josh jacobs",
      ),
    ).toBe("player.compare.reliability");
    expect(
      topReading(
        "who beats his projection more often james cook or josh jacobs",
      ),
    ).toBe("player.compare.reliability");
  });

  it("routes single-player reliability and projection questions", () => {
    expect(topReading("what is james cooks beat rate")).toBe(
      "player.reliability",
    );
    expect(
      topReading("how reliable is puka nacua against his projections"),
    ).toBe("player.reliability");
    expect(topReading("what is bijan robinson projected for")).toBe(
      "player.projection",
    );
    expect(
      topReading("who is projected higher bijan robinson or jahmyr gibbs"),
    ).toBe("player.compare.projection");
  });

  it("keeps a week-range projection separate from a rest-of-season one", () => {
    // The week range is what separates them, not the wording, so both the verb
    // and the noun reach the week capability when a range is present.
    expect(
      topReading(
        "project the season total from weeks 2 through week 4 from last year for michael wilson",
      ),
    ).toBe("player.weeks.projection");
    expect(
      topReading(
        "what is michael wilsons projected total from weeks 2 to 4 of last year",
      ),
    ).toBe("player.weeks.projection");
  });

  it("reads a multi-season span without eating the season inside it", () => {
    const span = (q: string) => extractEntities(normalizeText(q)).seasonSpan;
    expect(span("beat rate over the last 3 years")).toMatchObject({
      kind: "lastN",
      count: 3,
    });
    expect(span("beat rate over the past two seasons")).toMatchObject({
      kind: "lastN",
      count: 2,
    });
    expect(span("beat rate since 2023")).toMatchObject({
      kind: "since",
      season: 2023,
    });
    // "last year" is a single season and stays one, handled by the lexicon.
    expect(span("beat rate last year")).toBeNull();
    expect(
      extractEntities(normalizeText("beat rate last year")).seasons,
    ).toEqual([{ kind: "relative", offset: -1 }]);
  });

  it("leaves nothing unclaimed in a beat-rate question", () => {
    const e = extractEntities(
      normalizeText(
        "who has the better projection beat rate over the last 3 years between james cook and josh jacobs",
      ),
    );
    expect(e.nameSpans.map((s) => s.text)).toEqual([
      "james cook",
      "josh jacobs",
    ]);
    expect(e.concepts).toContain("reliability");
    expect(e.leftoverTokens).toEqual([]);
  });

  it("does not let the new capabilities steal an ordinary question", () => {
    // Each requires a concept word of its own, so a question that never mentions
    // projections or reliability cannot reach them.
    for (const question of [
      "how many passing yards did brock purdy have in 2025",
      "what is bijan robinson worth",
      "where does puka nacua rank",
      "who is better for dynasty garrett wilson or drake london",
      "how old is brock purdy",
    ]) {
      const scored = scoreCapabilities(
        CAPABILITIES,
        extractEntities(normalizeText(question)),
        settings,
      );
      const reachable = scored.map((c) => c.capability.id);
      expect(reachable, question).not.toContain("player.reliability");
      expect(reachable, question).not.toContain("player.compare.reliability");
      expect(reachable, question).not.toContain("player.projection");
      expect(reachable, question).not.toContain("player.compare.projection");
    }
  });
});

describe("leaderboards", () => {
  it("routes a top-N question to the ranked list", () => {
    for (const q of [
      "top 10 quarterbacks",
      "who are the top 25 running backs",
      "top 10 overall players",
      "best 5 tight ends",
      "top wide receivers",
    ]) {
      expect(topReading(q), q).toBe("rankings.top");
    }
  });

  it("claims the count before the season parser can read it as a year", () => {
    // "top 25" would otherwise be a question about the 2025 season.
    const e = extractEntities(
      normalizeText("who are the top 25 running backs"),
    );
    expect(e.topN).toMatchObject({ count: 25, stated: true });
    expect(e.seasons).toEqual([]);
    expect(e.positions).toEqual(["RB"]);
    expect(e.nameSpans).toEqual([]);
  });

  it("defaults the count without claiming the reader asked for one", () => {
    const e = extractEntities(normalizeText("top quarterbacks"));
    expect(e.topN).toMatchObject({ count: 10, stated: false });
  });

  it("caps an unreasonable count instead of refusing it", () => {
    expect(
      extractEntities(normalizeText("top 500 running backs")).topN,
    ).toMatchObject({
      count: 50,
    });
  });

  it("still sends a question about one named player to the rank capability", () => {
    expect(topReading("where does puka nacua rank")).toBe("player.rank");
  });
});

describe("what can I ask", () => {
  it("routes the question about the questions to the help capability", () => {
    for (const q of [
      "what type of questions can i ask",
      "what types of questions can i ask you",
      "what kind of questions can i ask beam",
      "what can i ask",
      "what can you do",
      "what can you answer",
      "what data do you have",
      "what should i ask",
      "help",
    ]) {
      expect(topReading(q), q).toBe("help.capabilities");
    }
  });

  it("never claims a question that already heads somewhere else", () => {
    // "tell me about" is a question head, and heads are matched before
    // concepts, so this one is a biography question before the help vocabulary
    // ever sees it.
    const e = extractEntities("what can you tell me about puka nacua");
    expect(e.concepts).not.toContain("help");
    expect(e.nameSpans.map((s) => s.text)).toContain("puka nacua");
    expect(topReading("what can you tell me about puka nacua")).not.toBe(
      "help.capabilities",
    );
  });

  it("leaves the subject visible when a help phrase sits beside a name", () => {
    // "Help me pick between X and Y" reads as the menu question by vocabulary
    // alone. build() resolves the span and steps aside once it turns out to be
    // a person; at this layer what matters is that the name survived intact.
    const e = extractEntities(
      "help me pick between bijan robinson and jahmyr gibbs",
    );
    expect(e.concepts).toContain("help");
    expect(e.nameSpans.map((s) => s.text)).toContain("bijan robinson");
  });
});

describe("the draft board", () => {
  it("routes steals, fades, and swings to the board", () => {
    for (const q of [
      "who are the draft steals",
      "show me the draft fades",
      "draft steals at running back",
      "which players should i avoid in my draft",
      "who is undervalued",
      "what does the draft guide say",
      "late round swings",
    ]) {
      expect(topReading(q), q).toBe("draft.board");
    }
  });

  it("keeps the two sides of the board apart", () => {
    expect(extractEntities("who are the draft steals").concepts).toContain(
      "draft-steal",
    );
    expect(extractEntities("show me the draft fades").concepts).toContain(
      "draft-fade",
    );
    expect(extractEntities("who should i avoid").concepts).toContain(
      "draft-fade",
    );
    expect(extractEntities("late round swings").concepts).toContain(
      "draft-swing",
    );
  });

  it("reads the position filter and leaves no stray name behind", () => {
    const e = extractEntities("draft steals at running back");
    expect(e.positions).toEqual(["RB"]);
    expect(e.nameSpans).toEqual([]);
  });

  it("lets a board question through the my-league gate", async () => {
    const { looksOutOfScope } = await import("./lexicon");
    const question = "which players should i avoid in my draft";
    // The phrase is the same one that makes "who should i draft" out of scope.
    expect(looksOutOfScope(question)).toBe(true);
    // The fade list does not depend on seeing the reader's draft, so it answers.
    expect(looksOutOfScope(question, { askingDraftBoard: true })).toBe(false);
  });

  it("still sends a question about one named player elsewhere", () => {
    // The board reading disqualifies itself in build() once the span resolves;
    // at this layer the name is what proves the question has a subject.
    const e = extractEntities("is bijan robinson a steal");
    expect(e.concepts).toContain("draft-steal");
    expect(e.nameSpans.map((s) => s.text)).toContain("bijan robinson");
  });
});

describe("out-of-scope detection", () => {
  it("flags questions about the reader's own league", async () => {
    const { looksOutOfScope } = await import("./lexicon");
    expect(looksOutOfScope("who should i start this week in my league")).toBe(
      true,
    );
    expect(looksOutOfScope("should i accept this trade")).toBe(true);
    expect(looksOutOfScope("how many yards did purdy throw for")).toBe(false);
  });

  it("lets a draft question through once the reader names both players", async () => {
    const { looksOutOfScope } = await import("./lexicon");
    const question = "who should i take in my draft ceedee lamb or puka nacua";
    // Without the two names it is a question about a board BEAM cannot see.
    expect(looksOutOfScope(question)).toBe(true);
    expect(looksOutOfScope("who should i take in my draft")).toBe(true);
    // With them it is an ordinary head-to-head.
    expect(looksOutOfScope(question, { comparingNamedPlayers: true })).toBe(
      false,
    );
  });

  it("keeps start-or-sit and trade questions out of scope even with two names", async () => {
    const { looksOutOfScope } = await import("./lexicon");
    // These depend on the rest of a roster, so naming two players does not make
    // them answerable. Only the draft-shaped phrases bend.
    expect(
      looksOutOfScope("should i trade bijan robinson or jahmyr gibbs", {
        comparingNamedPlayers: true,
      }),
    ).toBe(true);
    expect(
      looksOutOfScope("who should i start ceedee lamb or puka nacua", {
        comparingNamedPlayers: true,
      }),
    ).toBe(true);
  });
});
