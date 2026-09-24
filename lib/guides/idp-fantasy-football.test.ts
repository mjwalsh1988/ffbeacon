import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDP_GUIDE_LESSONS, buildIdpFaq } from "./idp-fantasy-football";
import { findPublishedGuide } from "./published";
import { pearson, yearOverYear } from "./idp-stability";
import { summarizeIdpLeagues } from "./idp-leagues";
import { topByPosition } from "./idp-seasons";
import { chaseOrIgnore, countEligibility, perGameByRank, rankGroups } from "./idp-scarcity";
import { draftRoundSentences, foldDefenderPosition, roundOf, summarizeFormat, type AdpRow } from "./idp-adp";

/**
 * The IDP guide (plan IDP-221). Source-level for the page, which reads the
 * database at render; the data readers and the FAQ builder are tested
 * directly.
 */
const FILES = [
  "app/guides/idp-fantasy-football/page.tsx",
  "app/guides/idp-fantasy-football/idp-figures.tsx",
  "app/guides/idp-fantasy-football/idp-classroom.tsx",
  "lib/guides/idp-fantasy-football.ts",
  "lib/guides/idp-adp.ts",
];
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const FACTS = summarizeIdpLeagues([
  { rosterPositions: ["QB", "RB", "DL", "LB", "BN"], scoringSettings: { idp_tkl: 1, idp_tkl_solo: 1 } },
  { rosterPositions: ["QB", "IDP_FLEX", "IDP_FLEX"], scoringSettings: { idp_tkl_solo: 2 } },
  { rosterPositions: ["QB", "RB", "WR"], scoringSettings: {} },
]);

describe("the IDP guide page", () => {
  const page = read("app/guides/idp-fantasy-football/page.tsx");

  it("renders an anchored section for every lesson and the FAQ", () => {
    for (const lesson of IDP_GUIDE_LESSONS) {
      expect(page, lesson.id).toMatch(new RegExp(`<Lesson id="${lesson.id}"`));
    }
    expect(page).toContain('id="faq-heading"');
  });

  it("builds FAQPage JSON-LD from the same FAQ array the accordion renders", () => {
    expect(page).toContain("faqPageJsonLd(FAQ)");
    expect(page).toContain("<FaqAccordion items={FAQ} />");
  });

  it("is plain ASCII in every file", () => {
    for (const file of FILES) {
      const src = read(file);
      // eslint-disable-next-line no-control-regex
      const bad = src.match(/[^\x00-\x7F]/g);
      expect(bad, `${file} has non-ASCII characters`).toBeNull();
    }
  });

  it("never uses the token WAR", () => {
    for (const file of FILES) expect(read(file)).not.toMatch(/\bWAR\b/);
  });

  it("is registered with a nav label that fits the rail", () => {
    const guide = findPublishedGuide("idp-fantasy-football");
    expect(guide?.navLabel).toBe("IDP Leagues");
    expect((guide?.navLabel ?? "").length).toBeLessThanOrEqual(20);
  });

  it("the OG route has a card for it (a missing card 404s)", () => {
    expect(read("app/api/og/guide/[slug]/route.tsx")).toContain('"idp-fantasy-football": {');
  });
});

describe("the FAQ agrees with the page's own figures", () => {
  it("states the flex-only count from the same facts", () => {
    const faq = buildIdpFaq(FACTS);
    const flex = faq.find((q) => q.question === "What does IDP flex mean?");
    expect(flex?.answer).toContain(`Of the ${FACTS.leagues} IDP leagues synced on FF Beacon, ${FACTS.flexOnly} start`);
  });

  it("does not claim League Pulse projects defenders", () => {
    const faq = buildIdpFaq(FACTS);
    expect(faq.find((q) => q.question.includes("project"))?.answer).toContain(
      "League Pulse does not project defenders yet",
    );
  });
});

describe("guide data", () => {
  it("summarizes league structure and the stacking count", () => {
    expect(FACTS.leagues).toBe(2);
    expect(FACTS.allLeagues).toBe(3);
    expect(FACTS.flexOnly).toBe(1);
    expect(FACTS.plainTackle).toBe(1);
    expect(FACTS.plainTackleAndSolo).toBe(1);
    expect(FACTS.medianStarters).toBe(2);
  });

  it("correlates year one with year two for qualifying players only", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    const rows = [
      { playerId: "a", season: 2024, position: "LB", games: 10, line: { idp_tkl: 100 } },
      { playerId: "a", season: 2025, position: "LB", games: 10, line: { idp_tkl: 110 } },
      { playerId: "b", season: 2024, position: "LB", games: 10, line: { idp_tkl: 50 } },
      { playerId: "b", season: 2025, position: "LB", games: 10, line: { idp_tkl: 60 } },
      { playerId: "c", season: 2024, position: "LB", games: 10, line: { idp_tkl: 80 } },
      { playerId: "c", season: 2025, position: "LB", games: 10, line: { idp_tkl: 75 } },
      // Too few games in year two: never paired.
      { playerId: "d", season: 2024, position: "LB", games: 10, line: { idp_tkl: 90 } },
      { playerId: "d", season: 2025, position: "LB", games: 3, line: { idp_tkl: 5 } },
    ];
    const lb = yearOverYear(rows).find((f) => f.position === "LB")!;
    expect(lb.pairs).toBe(3);
    expect(lb.tackles).toBeGreaterThan(0.9);
  });

  it("ranks the top players per position on Sleeper default IDP scoring", () => {
    const top = topByPosition(
      [
        { id: "s1", name: "Sacker", slug: "s", position: "DL", games: 17, line: { idp_sack: 15 } },
        { id: "t1", name: "Tackler", slug: "t", position: "DL", games: 17, line: { idp_tkl_solo: 40 } },
        { id: "p1", name: "Part-timer", slug: "p", position: "DL", games: 4, line: { idp_sack: 30 } },
      ],
      12,
    );
    // 15 sacks = 90, 40 solo = 80; the 4-game player is below the games floor.
    expect(top.DL.map((p) => p.name)).toEqual(["Sacker", "Tackler"]);
  });
});

describe("scarcity, eligibility and the quiz (IDP-2R3)", () => {
  const line = (pts: number) => ({ idp_tkl_solo: pts / 2 });
  const players = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ position: "LB", games: 10, line: line(200 - i * 5) }));

  it("ranks every qualifying player by points a game, best first", () => {
    const byRank = perGameByRank(
      [
        { position: "DL", games: 10, line: line(190) },
        { position: "DL", games: 17, line: line(340) },
        { position: "DL", games: 8, line: line(200) },
        { position: "DL", games: 4, line: line(160) },
        { position: "DB", games: 0, line: line(50) },
      ],
      48,
      8,
    );
    // 340/17 = 20 and 200/8 = 25: the shorter season ranks first on per game.
    // The 4-game player is under the floor; the zero-game player has no rate.
    expect(byRank.DL).toEqual([25, 20, 19]);
    expect(byRank.DB).toEqual([]);
  });

  it("a rank group is null unless every rank in it is present", () => {
    const rows = rankGroups({ DL: perGameByRank(players(12).map((p) => ({ ...p, position: "DL" })), 48, 8).DL, LB: perGameByRank(players(40), 48, 8).LB, DB: [] });
    const dl = rows.find((r) => r.position === "DL")!;
    expect(dl.groups[0].perGame).not.toBeNull();
    expect(dl.groups[1].perGame).not.toBeNull();
    expect(dl.groups[2].perGame).toBeNull();
    const lb = rows.find((r) => r.position === "LB")!;
    expect(lb.groups.every((g) => g.perGame !== null)).toBe(true);
  });

  it("eligibility buckets are exclusive and add up to the whole", () => {
    const c = countEligibility([
      { position: "DL", eligible: ["DL"] },
      { position: "DL", eligible: ["DL", "LB"] },
      { position: "LB", eligible: [] },
      { position: "DB", eligible: ["DB", "LB"] },
      { position: "DB", eligible: ["DB"] },
      { position: "LB", eligible: ["DL", "LB", "DB"] },
      { position: "WR", eligible: ["WR"] },
    ]);
    expect(c).toEqual({ dlOnly: 1, dlLb: 1, lbOnly: 1, dbLb: 1, dbOnly: 1, other: 1, onTeam: 6 });
  });

  it("the quiz answer follows the measured correlation, and skips an unmeasured one", () => {
    expect(chaseOrIgnore(0.65)).toBe("chase");
    expect(chaseOrIgnore(0.5)).toBe("chase");
    expect(chaseOrIgnore(0.33)).toBe("ignore");
    expect(chaseOrIgnore(null)).toBeNull();
  });
});

describe("lesson 7 draft rounds from the nightly Sleeper ADP", () => {
  // 30 linebackers from pick 70, 14 linemen from pick 100, 12 backs from 150,
  // one step of 4 picks each; plus an offensive row that must be ignored.
  const rows: AdpRow[] = [
    ...Array.from({ length: 30 }, (_, i) => ({ position: "LB", adp: { idp_1qb: 70 + i * 4, idp: 80 + i * 4 } })),
    ...Array.from({ length: 14 }, (_, i) => ({ position: "DL", adp: { idp_1qb: 100 + i * 4 } })),
    ...Array.from({ length: 12 }, (_, i) => ({ position: "DB", adp: { idp_1qb: 150 + i * 4 } })),
    { position: "WR", adp: { idp_1qb: 1, idp: 1 } },
    { position: "LB", adp: { idp_1qb: 999 } },
  ];

  it("counts 12-team rounds from overall picks", () => {
    expect(roundOf(1)).toBe(1);
    expect(roundOf(12)).toBe(1);
    expect(roundOf(13)).toBe(2);
    expect(roundOf(69.2)).toBe(6);
  });

  it("summarizes one format from defender rows only", () => {
    const f = summarizeFormat(rows, "idp_1qb")!;
    expect(f.defenders).toBe(56);
    expect(f.firstRound).toBe(6); // pick 70
    expect(f.inFirstFiveRounds).toBe(0);
    expect(f.twelfthByPosition).toEqual({ LB: roundOf(70 + 11 * 4), DL: roundOf(144), DB: roundOf(194) });
  });

  it("leaves out a format with too few priced defenders", () => {
    expect(summarizeFormat(rows, "idp")).not.toBeNull(); // 30 linebackers
    expect(summarizeFormat(rows.slice(0, 10), "idp")).toBeNull();
  });

  it("writes only the sentences it has figures for", () => {
    const oneQb = summarizeFormat(rows, "idp_1qb");
    const both = draftRoundSentences({ asOf: "2026-09-24T11:02:00Z", oneQb, superflex: summarizeFormat(rows, "idp") }, "Sep 24, 2026");
    expect(both.market).toContain("As of Sep 24, 2026");
    expect(both.market).toContain(
      "no defender goes in the first five rounds of one-quarterback or superflex IDP drafts.",
    );
    expect(both.market).toContain("superflex");
    expect(both.positions).toMatch(/^Linebackers come off the board first as a group./);
    const onlyOne = draftRoundSentences({ asOf: "x", oneQb, superflex: null }, "Sep 24, 2026");
    expect(onlyOne.market).not.toContain("superflex");
    expect(onlyOne.market).toContain("no defender goes in the first five rounds of one-quarterback IDP drafts.");
  });

  it("says no rather than printing a zero when only one format has early defenders", () => {
    const early: AdpRow[] = [
      ...rows,
      ...Array.from({ length: 3 }, (_, i) => ({ position: "DL", adp: { idp: 30 + i } })),
    ];
    const out = draftRoundSentences(
      { asOf: "x", oneQb: summarizeFormat(early, "idp_1qb"), superflex: summarizeFormat(early, "idp") },
      "Sep 24, 2026",
    );
    expect(out.market).toContain("no defenders go in the first five rounds of one-quarterback IDP drafts");
    expect(out.market).toContain("3 defenders go in the first five rounds of superflex IDP drafts");
    expect(out.market).not.toMatch(/0 defenders/);
  });

  it("names superflex on its own when it is the only format measured", () => {
    const out = draftRoundSentences({ asOf: "x", oneQb: null, superflex: summarizeFormat(rows, "idp") }, "Sep 24, 2026");
    expect(out.market).toContain("of superflex IDP drafts.");
    expect(out.market).toContain("In superflex IDP drafts the first defender goes in round");
    expect(out.positions).toBeNull(); // only linebackers carry the superflex key here
  });

  it("names no leading position when the twelfth at two positions go in the same round", () => {
    const tie: AdpRow[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ position: "LB", adp: { idp_1qb: 100 + i } })),
      ...Array.from({ length: 12 }, (_, i) => ({ position: "DL", adp: { idp_1qb: 100 + i } })),
    ];
    const out = draftRoundSentences({ asOf: "x", oneQb: summarizeFormat(tie, "idp_1qb"), superflex: null }, "Sep 24, 2026");
    expect(out.positions).not.toContain("first as a group");
    expect(out.positions).toContain("the twelfth linebacker goes in round 10");
  });
});

describe("defender labels in the ADP read", () => {
  it("folds Sleeper's finer labels into the three guide positions", () => {
    expect(foldDefenderPosition("DE")).toBe("DL");
    expect(foldDefenderPosition("olb")).toBe("LB");
    expect(foldDefenderPosition("CB")).toBe("DB");
    expect(foldDefenderPosition("DEF")).toBeNull();
    expect(foldDefenderPosition("WR")).toBeNull();
    expect(foldDefenderPosition(null)).toBeNull();
  });
});
