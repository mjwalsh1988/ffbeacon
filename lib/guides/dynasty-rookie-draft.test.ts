import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPITAL_POSITIONS,
  DRAFT_CAPITAL,
  ROOKIE_GUIDE_LESSONS,
  ROOKIE_PICK_HIT_RATES,
  buildRookieFaq,
  clockCall,
  outOfTen,
  ownPicks,
  slotOdds,
  sortRookie,
  type CapitalDay,
  type DepthPath,
  type Lane,
  type SlotBand,
  type TierShape,
} from "./dynasty-rookie-draft";
import { findPublishedGuide } from "./published";
import {
  MIN_DRAFTS_FOR_BOARD,
  MIN_DRAFTS_FOR_FACTS,
  MIN_PRICE_WEEKS,
  buildClassBoard,
  buildPickLadder,
  buildPriceHistory,
  buildQbGap,
  lastMethodBreak,
  easternMonth,
  mondayOf,
  summarizeRookieDrafts,
  upcomingRookieClass,
  type AdpRow,
  type PriceRow,
  type RookieDraftRow,
} from "./rookie-draft-data";

/**
 * The dynasty rookie draft guide. Source-level for the page, which reads the
 * database at render; the pure builders behind every live figure and the
 * rules behind every interactive box are tested directly.
 */
const FILES = [
  "app/guides/dynasty-rookie-draft/page.tsx",
  "app/guides/dynasty-rookie-draft/rookie-figures.tsx",
  "app/guides/dynasty-rookie-draft/rookie-classroom.tsx",
  "lib/guides/dynasty-rookie-draft.ts",
  "lib/guides/rookie-draft-data.ts",
];
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("the rookie draft guide page", () => {
  const page = read("app/guides/dynasty-rookie-draft/page.tsx");

  it("renders an anchored section for every lesson and the FAQ", () => {
    for (const lesson of ROOKIE_GUIDE_LESSONS) {
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
      const bad = read(file).match(/[^\x00-\x7F]/g);
      expect(bad, `${file} has non-ASCII characters`).toBeNull();
    }
  });

  it("never uses the token WAR", () => {
    for (const file of FILES) expect(read(file)).not.toMatch(/\bWAR\b/);
  });

  it("is registered with a nav label that fits the rail", () => {
    const guide = findPublishedGuide("dynasty-rookie-draft");
    expect(guide?.navLabel).toBe("Rookie Draft Guide");
    expect((guide?.navLabel ?? "").length).toBeLessThanOrEqual(20);
  });

  it("the OG route has a card for it (a missing card 404s)", () => {
    expect(read("app/api/og/guide/[slug]/route.tsx")).toContain('"dynasty-rookie-draft": {');
  });

  it("the dynasty strategy guide draws the same hit rates, not a copy", () => {
    const figures = read("app/guides/dynasty-strategy/dynasty-figures.tsx");
    expect(figures).toContain("const HIT_RATES = ROOKIE_PICK_HIT_RATES;");
  });
});

describe("published figures", () => {
  it("the hit rates fall from the 1.01 to round three", () => {
    expect(ROOKIE_PICK_HIT_RATES[0].hit).toBeGreaterThan(ROOKIE_PICK_HIT_RATES[1].hit);
    expect(ROOKIE_PICK_HIT_RATES[ROOKIE_PICK_HIT_RATES.length - 1].hit).toBeLessThan(10);
    for (const h of ROOKIE_PICK_HIT_RATES) expect(h.hitOrMid).toBeGreaterThanOrEqual(h.hit);
  });

  it("each draft capital table adds up to its stated sample", () => {
    for (const pos of CAPITAL_POSITIONS) {
      const study = DRAFT_CAPITAL[pos];
      expect(study.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(study.rounds.reduce((s, r) => s + r.players, 0)).toBe(study.players);
      for (const r of study.rounds) expect(r.top12).toBeLessThanOrEqual(r.wide);
    }
  });

  it("two quarterbacks taken after round two cleared the top 24, as the page says", () => {
    const later = DRAFT_CAPITAL.QB.rounds.slice(2);
    expect(later.reduce((s, r) => s + Math.round((r.wide * r.players) / 100), 0)).toBe(2);
    expect(read("app/guides/dynasty-rookie-draft/page.tsx")).toContain("two cleared");
  });

  it("turns a rate into an out-of-ten reading", () => {
    expect(outOfTen(83.33)).toBe(8);
    expect(outOfTen(37.5)).toBe(4);
    expect(outOfTen(8.33)).toBe(1);
    expect(outOfTen(0)).toBe(0);
  });
});

describe("the interactive rules", () => {
  it("a linear draft picks in the same place every round", () => {
    expect(ownPicks(12, 5, 4, "linear").map((p) => p.label)).toEqual(["1.05", "2.05", "3.05", "4.05"]);
    expect(ownPicks(12, 5, 4, "linear").map((p) => p.overall)).toEqual([5, 17, 29, 41]);
  });

  it("a snake draft reverses the even rounds", () => {
    expect(ownPicks(12, 5, 4, "snake").map((p) => p.label)).toEqual(["1.05", "2.08", "3.05", "4.08"]);
    expect(ownPicks(10, 1, 3, "snake").map((p) => p.overall)).toEqual([1, 20, 21]);
  });

  it("clamps a slot the league does not have", () => {
    expect(ownPicks(10, 14, 1, "linear")[0].label).toBe("1.10");
  });

  it("every sorter and clock combination has an answer", () => {
    for (const c of ["day1", "day2", "day3"] as CapitalDay[]) {
      for (const p of ["open", "shared", "blocked"] as DepthPath[]) {
        const r = sortRookie(c, p);
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.body.length).toBeGreaterThan(40);
      }
    }
    for (const lane of ["contend", "middle", "rebuild"] as Lane[]) {
      for (const band of ["top4", "mid1", "late1", "later"] as SlotBand[]) {
        for (const tier of ["clear", "flat"] as TierShape[]) {
          expect(clockCall(lane, band, tier).call.length).toBeGreaterThan(0);
        }
        expect(slotOdds(band)).toContain("Dynasty Nerds");
      }
    }
  });

  it("a top-four pick is never traded back, and a contender never sits on a flat late first", () => {
    expect(clockCall("rebuild", "top4", "flat").call).toBe("Make the pick");
    expect(clockCall("contend", "late1", "flat").call).toBe("Sell the pick for a veteran");
    expect(clockCall("rebuild", "mid1", "flat").call).toBe("Trade back");
    expect(clockCall("contend", "mid1", "clear").call).toBe("Make the pick");
  });
});

describe("the FAQ agrees with the page's own figures", () => {
  it("quotes the live facts when it has them and stays general when it does not", () => {
    const facts = {
      season: 2026,
      drafts: 353,
      linearPct: 93,
      commonRounds: 4,
      commonRoundsPct: 58,
      busiestMonth: "May",
      busiestMonthPct: 40,
      byEndOfMayPct: 63,
    };
    const live = buildRookieFaq(facts);
    expect(live.find((q) => q.question.startsWith("Are rookie drafts"))?.answer).toContain(
      "Of the 353 rookie drafts FF Beacon synced from Sleeper in 2026, 93 percent were linear.",
    );
    expect(live.find((q) => q.question.startsWith("When do"))?.answer).toContain("40 percent started in May");
    const plain = buildRookieFaq(null);
    expect(plain).toHaveLength(live.length);
    for (const q of plain) expect(q.answer).not.toMatch(/undefined|null|NaN/);
  });

  it("states the same hit rates the meters draw", () => {
    const answer = buildRookieFaq(null).find((q) => q.question.startsWith("How often"))?.answer ?? "";
    expect(answer).toContain("the 1.01 hit 83 percent");
    expect(answer).toContain("round three 8 percent");
  });
});

/* ---------- live figure builders ---------- */

function draft(season: number, over: Partial<RookieDraftRow> = {}): RookieDraftRow {
  return { season, draftType: "linear", teams: 12, rounds: 4, startedAt: `${season}-05-10T16:00:00Z`, ...over };
}

const NOW = new Date("2026-11-13T12:00:00Z");

describe("rookie draft facts", () => {
  it("reads the month in Eastern time", () => {
    // 02:00 UTC on May 1 is still April 30 in New York.
    expect(easternMonth("2026-05-01T02:00:00Z")).toBe(4);
    expect(easternMonth("2026-05-01T12:00:00Z")).toBe(5);
    expect(easternMonth(null)).toBeNull();
    expect(easternMonth("not a date")).toBeNull();
  });

  it("says nothing about a season with too few drafts", () => {
    const rows = Array.from({ length: MIN_DRAFTS_FOR_FACTS - 1 }, () => draft(2026));
    expect(summarizeRookieDrafts(rows, NOW)).toBeNull();
  });

  it("describes the newest season that has enough, not a thin newer one", () => {
    const rows = [
      ...Array.from({ length: 40 }, () => draft(2026)),
      ...Array.from({ length: 3 }, () => draft(2027)),
    ];
    const facts = summarizeRookieDrafts(rows, NOW)!;
    expect(facts.season).toBe(2026);
    expect(facts.drafts).toBe(40);
    expect(facts.allSeasonsDrafts).toBe(43);
  });

  it("never describes a class that is still being drafted", () => {
    const rows = [
      ...Array.from({ length: 40 }, () => draft(2026)),
      ...Array.from({ length: 90 }, () => draft(2027)),
    ];
    // Early May 2027: ninety drafts in, none of the August ones yet.
    expect(summarizeRookieDrafts(rows, new Date("2027-05-06T12:00:00Z"))?.season).toBe(2026);
    expect(summarizeRookieDrafts(rows, new Date("2027-08-31T12:00:00Z"))?.season).toBe(2026);
    expect(summarizeRookieDrafts(rows, new Date("2027-09-01T12:00:00Z"))?.season).toBe(2027);
  });

  it("counts order, length, size and start month over more than a thousand drafts", () => {
    const rows: RookieDraftRow[] = [
      ...Array.from({ length: 900 }, () => draft(2026)),
      ...Array.from({ length: 100 }, () => draft(2026, { draftType: "snake", rounds: 3, teams: 10 })),
      ...Array.from({ length: 200 }, () => draft(2026, { rounds: 5, startedAt: "2026-08-20T16:00:00Z" })),
      ...Array.from({ length: 50 }, () => draft(2026, { startedAt: null })),
    ];
    const facts = summarizeRookieDrafts(rows, NOW)!;
    expect(facts.drafts).toBe(1250);
    expect(facts.linearPct).toBe(92);
    expect(facts.commonRounds).toBe(4);
    expect(facts.commonRoundsPct).toBe(76);
    expect(facts.rounds.map((r) => r.key)).toEqual(["3", "4", "5"]);
    expect(facts.commonTeams).toBe(12);
    expect(facts.busiestMonth).toBe("May");
    // 1,000 of the 1,200 dated drafts started in May; the undated 50 are not in the base.
    expect(facts.busiestMonthPct).toBe(83);
    expect(facts.byEndOfMayPct).toBe(83);
    expect(facts.months.map((m) => m.label)).toEqual(["May", "August"]);
  });
});

const FORMATS = [
  { slug: "dynasty-ppr-std", display_name: "Dynasty PPR", league_type: "dynasty", is_superflex: false },
  { slug: "dynasty-ppr-tep", display_name: "Dynasty TE Premium", league_type: "dynasty", is_superflex: false },
  { slug: "dynasty-ppr-sflex", display_name: "Dynasty Superflex", league_type: "dynasty", is_superflex: true },
  { slug: "redraft-ppr-std", display_name: "Redraft PPR", league_type: "redraft", is_superflex: false },
];

function adp(formatSlug: string, n: number, drafts: number, over: Partial<AdpRow> = {}): AdpRow {
  return {
    season: 2026,
    formatSlug,
    name: `${formatSlug} player ${n}`,
    slug: `${formatSlug}-player-${n}`,
    position: n % 4 === 0 ? "TE" : n % 3 === 0 ? "RB" : "WR",
    adp: n,
    stdev: n / 4,
    earliest: Math.max(1, n - 3),
    latest: n + 6,
    draftRate: 0.9,
    drafts,
    ...over,
  };
}

describe("the class board", () => {
  const std = Array.from({ length: 30 }, (_, i) => adp("dynasty-ppr-std", i + 1, 65));
  const tep = Array.from({ length: 30 }, (_, i) => adp("dynasty-ppr-tep", i + 1, 8));

  it("ranks the first 24 by average pick in the reader's format", () => {
    const board = buildClassBoard(std, FORMATS, "dynasty-ppr-std", NOW)!;
    expect(board.format.displayName).toBe("Dynasty PPR");
    expect(board.drafts).toBe(65);
    expect(board.players).toHaveLength(24);
    expect(board.players[0].rank).toBe(1);
    expect(board.players[11].adp).toBe(12);
    expect(Object.values(board.firstRound).reduce((a, b) => a + b, 0)).toBe(12);
    // Spread widens down the board in this fixture, as stdev = pick / 4.
    expect(board.spread[0].stdev).toBeCloseTo(0.5, 5);
    expect(board.spread[3].stdev!).toBeGreaterThan(board.spread[0].stdev!);
  });

  it("falls back to the best-sampled format with the same quarterback count, and names it", () => {
    const board = buildClassBoard([...std, ...tep], FORMATS, "dynasty-ppr-tep", NOW)!;
    expect(board.format.slug).toBe("dynasty-ppr-std");
    expect(board.drafts).toBeGreaterThanOrEqual(MIN_DRAFTS_FOR_BOARD);
  });

  it("waits for fifty drafts before it shows a class that is still being drafted", () => {
    const next = Array.from({ length: 30 }, (_, i) => adp("dynasty-ppr-std", i + 1, 30, { season: 2027 }));
    const may = new Date("2027-05-06T12:00:00Z");
    expect(buildClassBoard([...std, ...next], FORMATS, "dynasty-ppr-std", may)?.season).toBe(2026);
    const more = next.map((r) => ({ ...r, drafts: 50 }));
    expect(buildClassBoard([...std, ...more], FORMATS, "dynasty-ppr-std", may)?.season).toBe(2027);
    // Once the class is finished, twenty is enough again.
    expect(buildClassBoard([...std, ...next], FORMATS, "dynasty-ppr-std", new Date("2027-09-02T12:00:00Z"))?.season).toBe(2027);
  });

  it("never borrows a board across the quarterback count", () => {
    expect(buildClassBoard(std, FORMATS, "dynasty-ppr-sflex", NOW)).toBeNull();
  });

  it("leaves out rarely drafted players, defenders and non-dynasty formats", () => {
    const noisy = [
      ...std,
      adp("dynasty-ppr-std", 0.5, 65, { name: "Stray veteran", draftRate: 0.02 }),
      adp("dynasty-ppr-std", 0.6, 65, { name: "A linebacker", position: "LB" }),
    ];
    const board = buildClassBoard(noisy, FORMATS, "dynasty-ppr-std", NOW)!;
    expect(board.players.map((p) => p.name)).not.toContain("Stray veteran");
    expect(board.players.map((p) => p.name)).not.toContain("A linebacker");
    expect(buildClassBoard(std, FORMATS, "redraft-ppr-std", NOW)).toBeNull();
  });
});

describe("the quarterback gap", () => {
  it("pairs each quarterback across one-quarterback and superflex drafts", () => {
    const rows = [
      adp("dynasty-ppr-std", 12.1, 65, { name: "First QB", slug: "first-qb", position: "QB" }),
      adp("dynasty-ppr-sflex", 3.4, 94, { name: "First QB", slug: "first-qb", position: "QB" }),
      adp("dynasty-ppr-sflex", 11.4, 94, { name: "Second QB", slug: "second-qb", position: "QB" }),
      adp("dynasty-ppr-std", 2, 65),
    ];
    const gap = buildQbGap(rows, FORMATS, NOW)!;
    expect(gap.oneQb.displayName).toBe("Dynasty PPR");
    expect(gap.superflex.drafts).toBe(94);
    // The second quarterback is not drafted often enough in one-quarterback leagues to pair.
    expect(gap.rows).toEqual([{ name: "First QB", slug: "first-qb", oneQb: 12.1, superflex: 3.4 }]);
  });

  it("prefers a pair that agrees on tight end premium over the two biggest samples", () => {
    const formats = [
      { slug: "one", display_name: "One QB", league_type: "dynasty", is_superflex: false, te_premium_bonus: 0 },
      { slug: "sf", display_name: "Superflex", league_type: "dynasty", is_superflex: true, te_premium_bonus: 0 },
      { slug: "sf-tep", display_name: "Superflex TEP", league_type: "dynasty", is_superflex: true, te_premium_bonus: 0.5 },
    ];
    const rows = [
      adp("one", 12, 65, { position: "QB", slug: "q" }),
      adp("sf", 4, 94, { position: "QB", slug: "q" }),
      adp("sf-tep", 3, 196, { position: "QB", slug: "q" }),
    ];
    const gap = buildQbGap(rows, formats, NOW)!;
    expect(gap.superflex.displayName).toBe("Superflex");
    expect(gap.rows[0].superflex).toBe(4);
    // With no matching pair, the best-sampled one still shows.
    expect(buildQbGap(rows, formats.filter((x) => x.slug !== "sf"), NOW)?.superflex.displayName).toBe("Superflex TEP");
  });

  it("is null when one side has too few drafts", () => {
    const rows = [
      adp("dynasty-ppr-std", 12, 5, { position: "QB", slug: "q" }),
      adp("dynasty-ppr-sflex", 3, 94, { position: "QB", slug: "q" }),
    ];
    expect(buildQbGap(rows, FORMATS, NOW)).toBeNull();
  });
});

describe("the pick ladder", () => {
  const rows = [2027, 2028].flatMap((season) =>
    [1, 2, 3, 4].flatMap((round) =>
      (["early", "mid", "late"] as const).map((pick_position, i) => ({
        season,
        round,
        pick_position,
        value: (season === 2027 ? 6000 : 5000) / round - i * 100,
      })),
    ),
  );

  it("a class is the coming one until September of its own year", () => {
    expect(upcomingRookieClass(new Date("2026-11-13T12:00:00Z"))).toBe(2027);
    expect(upcomingRookieClass(new Date("2027-05-10T12:00:00Z"))).toBe(2027);
    expect(upcomingRookieClass(new Date("2027-08-31T12:00:00Z"))).toBe(2027);
    expect(upcomingRookieClass(new Date("2027-09-01T12:00:00Z"))).toBe(2028);
  });

  it("indexes every slot to the early first", () => {
    const ladder = buildPickLadder(rows, 2027)!;
    expect(ladder.season).toBe(2027);
    expect(ladder.slots).toHaveLength(12);
    expect(ladder.slots[0]).toMatchObject({ label: "Early 1st", index: 100 });
    expect(ladder.slots.find((s) => s.key === "2-early")?.index).toBe(50);
    // 2028 mid first 4,900 against 2027 mid first 5,900.
    expect(ladder.nextYearDiscountPct).toBe(17);
  });

  it("moves to the next class the source still prices, and is null with none", () => {
    expect(buildPickLadder(rows, 2028)?.season).toBe(2028);
    expect(buildPickLadder(rows, 2028)?.nextYearDiscountPct).toBeNull();
    expect(buildPickLadder(rows, 2029)).toBeNull();
    expect(buildPickLadder([], 2027)).toBeNull();
  });
});

describe("the price history", () => {
  it("finds the Monday of a week in UTC", () => {
    expect(mondayOf("2026-11-13T05:00:00Z")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15T23:00:00Z")).toBe("2026-11-09");
    expect(mondayOf("2026-11-16T00:00:00Z")).toBe("2026-11-16");
    expect(mondayOf("nope")).toBeNull();
  });

  it("averages by week and reads the change, the high and the drop after it", () => {
    const start = Date.UTC(2026, 5, 15);
    // No step past 5 percent between captures, so the whole series is one method.
    const weekly = [5400, 5500, 5300, 5100, 4900, 4750, 4760, 4800, 4850, 4740];
    const rows: PriceRow[] = weekly.flatMap((v, w) =>
      [0, 1].flatMap((d) => {
        const capturedAt = new Date(start + (w * 7 + d) * 86_400_000).toISOString();
        return [
          { capturedAt, round: 1, value: v + (d === 0 ? -10 : 10) },
          { capturedAt, round: 2, value: v / 2 },
        ];
      }),
    );
    const h = buildPriceHistory(rows, 2027)!;
    expect(h.points).toHaveLength(10);
    expect(h.points[0]).toEqual({ week: "2026-06-15", first: 5400, second: 2700 });
    expect(h.high).toEqual({ week: "2026-06-22", value: 5500 });
    expect(h.low.value).toBe(4740);
    expect(h.latest.value).toBe(4740);
    expect(h.changePct).toBe(-12.2);
    expect(h.dropFromHighPct).toBe(13.8);
  });

  it("starts the line the week after the source changed its method", () => {
    const day = (n: number) => new Date(Date.UTC(2026, 5, 15) + n * 86_400_000).toISOString();
    // Two weeks at 5,630, a 13 percent step on day 13, then twelve weeks near 4,880.
    const rows: PriceRow[] = Array.from({ length: 98 }, (_, n) => ({
      capturedAt: day(n),
      round: 1,
      value: n < 13 ? 5630 : 4880 - (n % 7),
    }));
    expect(lastMethodBreak(rows)).toBe(day(13));
    const h = buildPriceHistory(rows, 2027)!;
    expect(h.methodChangedOn).toBe("2026-06-28");
    // The week of the change (June 22) is dropped whole.
    expect(h.points[0].week).toBe("2026-06-29");
    expect(Math.abs(h.changePct)).toBeLessThan(1);
    expect(h.dropFromHighPct).toBeLessThan(1);
    // A steady series has no break and keeps every week.
    expect(lastMethodBreak(rows.slice(13))).toBeNull();
    expect(buildPriceHistory(rows.slice(14), 2027)?.methodChangedOn).toBeNull();
  });

  it("is null until there are enough weeks to call it a line", () => {
    const rows: PriceRow[] = Array.from({ length: MIN_PRICE_WEEKS - 1 }, (_, w) => ({
      capturedAt: new Date(Date.UTC(2026, 5, 15) + w * 7 * 86_400_000).toISOString(),
      round: 1,
      value: 5000,
    }));
    expect(buildPriceHistory(rows, 2027)).toBeNull();
  });
});
