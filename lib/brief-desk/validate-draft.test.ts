import { describe, expect, it } from "vitest";
import { draftSchema } from "./draft-schema";
import { validateDraft, type ValidationContext } from "./validate-draft";
import type { Draft } from "./types";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";

const PERIOD = {
  season: "2026",
  week: 2,
  phase: "regular" as const,
  preSeasonWeek: null,
  periodStart: "2026-09-15T13:00:00.000Z",
  periodEnd: "2026-09-22T13:00:00.000Z",
};

const CTX: ValidationContext = {
  period: PERIOD,
  relays: [
    { id: R1, relevance_tier: 3, headline: "Barkley to IR" },
    { id: R2, relevance_tier: 2, headline: "Pitts signs" },
  ],
  datasets: {
    week_stat_tiles: "week_stat_tiles",
    value_movers_up: "value_movers_up",
    top_scorers_rb: "top_scorers",
    injury_timeline: "injury_timeline",
    waiver_targets: "waiver_targets",
    value_movers_by_format: "value_movers_by_format",
  },
  playerIds: new Set([P1]),
  existingSlugs: new Set(["week-1-fantasy-football-news-injuries-2026"]),
};

const para = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} about a player and his week.`).join(" ");

function goodDraft(): Draft {
  return draftSchema.parse({
    edition: { season: "2026", week: 2, period_start: PERIOD.periodStart, period_end: PERIOD.periodEnd },
    title: "Week 2 Fantasy Football News and Injuries (2026): Barkley, Pitts and the waiver wire",
    slug: "week-2-fantasy-football-news-injuries-2026",
    meta_description: "Every week 2 injury, signing and role change checked against the numbers, with what a dynasty and a redraft manager should do about each.",
    tl_dr: para(6),
    format_note: "Values and ranks below are shown for Dynasty Superflex PPR and Redraft PPR (1QB) on KeepTradeCut.",
    sections: [
      { id: "injuries", heading: "Injuries and availability", icon: "injury", eyebrow: "Week 2, part 1 of 3", body_md: para(70), relay_ids: [R1], block_refs: ["tiles", "timeline"], citations: [{ url: "https://example.com/a", claim: "Barkley placed on IR" }] },
      { id: "moves", heading: "Trades, signings and releases", icon: "transaction", eyebrow: "Week 2, part 2 of 3", body_md: para(70), relay_ids: [R2], block_refs: ["movers", "toggle"], citations: [] },
      { id: "actions", heading: "What to do this week", icon: "waiver", eyebrow: "Week 2, part 3 of 3", body_md: para(70), relay_ids: [], block_refs: ["actions", "scorers"], citations: [] },
    ],
    blocks: [
      { id: "tiles", kind: "stat_tiles", dataset_id: "week_stat_tiles", caption: "The week in six numbers", conclusion: "Quiet week." },
      { id: "movers", kind: "value_movers", dataset_id: "value_movers_up", caption: "Risers", conclusion: "Pitts rose most.", options: { direction: "up" } },
      { id: "scorers", kind: "top_scorers", dataset_id: "top_scorers_rb", caption: "Top backs", conclusion: "One back cleared 30.", options: { positions: ["RB"] } },
      { id: "timeline", kind: "injury_timeline", dataset_id: "injury_timeline", caption: "Who is back when", conclusion: "Two return by week 6." },
      { id: "actions", kind: "action_list", dataset_id: "waiver_targets", caption: "Bids", conclusion: "One bid worth making.", options: { items: [{ player_id: P1, action: "waiver", tool: "faab", note: "Bid 8 percent." }] } },
      { id: "toggle", kind: "format_toggle", dataset_id: "value_movers_by_format", caption: "Both formats", conclusion: "Redraft cares less." },
    ],
    faq: [{ question: "Is Saquon Barkley out for the season?", answer_md: para(4) }],
    players: [P1],
    teams: ["PHI"],
    research_log: [{ claim: "Barkley placed on IR", url: "https://example.com/a", fetched_at: "2026-09-22T13:10:00Z", note: "Confirmed." }],
    run: { source: "manual", run_id: null, model: null },
  });
}

describe("validateDraft", () => {
  it("accepts the reference-shaped draft and warns about nothing", () => {
    const out = validateDraft(goodDraft(), CTX);
    expect(out.errors).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.word_count).toBeGreaterThan(1800);
  });

  it("rejects a relay that is not in the bundle and warns about an uncited tier 3", () => {
    const d = goodDraft();
    d.sections[0].relay_ids = ["44444444-4444-4444-8444-444444444444"];
    const out = validateDraft(d, CTX);
    expect(out.errors.some((e) => e.includes("not in the bundle"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("tier 3 relay not cited"))).toBe(true);
  });

  it("rejects a citation that was never fetched, raw HTML and a banned character", () => {
    const d = goodDraft();
    d.sections[1].citations = [{ url: "https://example.com/never", claim: "x" }];
    d.sections[2].body_md += " <b>bold</b> and a dash — here";
    const out = validateDraft(d, CTX);
    expect(out.errors.some((e) => e.includes("not in research_log"))).toBe(true);
    expect(out.errors.some((e) => e.includes("raw HTML"))).toBe(true);
    expect(out.errors.some((e) => e.includes("em dash"))).toBe(true);
  });

  it("rejects bad block options, an unknown dataset and a player outside the bundle", () => {
    const d = goodDraft();
    d.blocks[1].options = { limit: 99 };
    d.blocks[2].dataset_id = "nope";
    (d.blocks[4].options as { items: Array<{ player_id: string }> }).items[0].player_id = "55555555-5555-4555-8555-555555555555";
    const out = validateDraft(d, CTX);
    expect(out.errors.some((e) => e.includes('block "movers" options'))).toBe(true);
    expect(out.errors.some((e) => e.includes("not in datasets"))).toBe(true);
    expect(out.errors.some((e) => e.includes("not in the bundle"))).toBe(true);
  });

  it("enforces the in-season slug prefix, the fixed title pattern and the required blocks", () => {
    const d = goodDraft();
    d.slug = "barkley-week";
    d.title_options = [];
    d.blocks = d.blocks.filter((b) => b.kind !== "injury_timeline");
    const out = validateDraft(d, CTX);
    expect(out.errors.some((e) => e.includes('must start with "week-2-"'))).toBe(true);
    expect(out.errors.some((e) => e.includes("title_options are not accepted"))).toBe(true);
    expect(out.errors.some((e) => e.includes("missing an injury_timeline"))).toBe(true);
  });

  it("requires exactly three title options off-season and tolerates missing scoreboard blocks as warnings", () => {
    const d = goodDraft();
    d.edition.week = null;
    d.slug = "free-agency-fantasy-football-news-2026";
    d.blocks = d.blocks.filter((b) => b.kind !== "top_scorers");
    d.sections[2].block_refs = ["actions"];
    const off: ValidationContext = { ...CTX, period: { ...PERIOD, week: null, phase: "off" } };
    const missing = validateDraft(d, off);
    expect(missing.errors.some((e) => e.includes("exactly three title_options"))).toBe(true);
    d.title_options = Array.from({ length: 3 }, (_, i) => ({
      title: `Free Agency Fantasy Football News and Values, Option ${i + 1} (2026)`,
      slug: `free-agency-fantasy-football-option-${i + 1}`,
      target_queries: ["free agency fantasy football"],
      rationale: "Matches the queries in the log.",
    }));
    const out = validateDraft(d, off);
    expect(out.errors.filter((e) => e.includes("title_options"))).toEqual([]);
    expect(out.warnings.some((w) => w.includes("missing a top_scorers"))).toBe(true);
  });

  it("warns, without rejecting, about a title or description past the display limit and a thin FAQ", () => {
    const d = goodDraft();
    d.title = "Week 2 Fantasy Football News and Injuries (2026): Barkley, Pitts, the waiver wire and the trades";
    d.meta_description =
      "Every week 2 injury, signing and role change checked against the numbers, with what a dynasty and a redraft manager should do about each one of them this week.";
    const out = validateDraft(d, CTX);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w) => w.startsWith("title is") && w.includes("search result"))).toBe(true);
    expect(out.warnings.some((w) => w.startsWith("meta_description is") && w.includes("search result"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("faq has 1 question"))).toBe(true);

    d.title = "Week 2 Fantasy Football News and Injuries (2026)";
    d.meta_description = "Every week 2 injury, signing and role change, checked against the numbers, for dynasty and redraft.";
    d.faq = Array.from({ length: 3 }, (_, i) => ({ question: `Question number ${i + 1} about the week?`, answer_md: para(3) }));
    const quiet = validateDraft(d, CTX);
    expect(quiet.warnings.filter((w) => w.includes("search result") || w.startsWith("faq has"))).toEqual([]);
  });

  it("rejects an edition that does not match the open period", () => {
    const d = goodDraft();
    d.edition.week = 3;
    expect(validateDraft(d, CTX).errors[0]).toContain("does not match the open period");
  });
});
