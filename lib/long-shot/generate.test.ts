import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { buildPuzzle, MAX_TRIES_PER_FAMILY, paramsKey, tierCandidates, type AnswersLoader } from "./generate";
import { mulberry32, seedFor } from "./random";
import { fakeCtx } from "./templates/test-context";
import type { TemplateFamily } from "./templates/types";
import { TEMPLATE_KEYS, type TemplateKey, type TemplateSource } from "./types";

const SOURCES: TemplateSource[] = ["stat_lines", "finishes", "market", "leagues", "history_rosters", "history_careers", "history_stats"];

/** A family whose draws are counters, so every draw is a distinct parameter set. */
function fakeFamily(
  key: TemplateKey,
  opts: { skip?: boolean; source?: TemplateSource; position?: string } = {},
): TemplateFamily {
  return {
    key,
    enabledByDefault: true,
    source: opts.source ?? SOURCES[TEMPLATE_KEYS.indexOf(key) % SOURCES.length],
    draws: (rng) => (opts.skip ? [] : Array.from({ length: 6 }, () => ({ n: Math.floor(rng() * 1e9) }))),
    position: () => opts.position ?? null,
    text: (params) => `${key} ${String(params.n)}`,
    answers: async () => [],
  };
}

const ids = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Settings with only the named families enabled. */
function s2(keys: TemplateKey[]) {
  const s = structuredClone(DEFAULT_LONG_SHOT_SETTINGS);
  for (const k of TEMPLATE_KEYS) s.templates[k].enabled = keys.includes(k);
  return s;
}
const allPool = new Set(ids(500));
const families = TEMPLATE_KEYS.map((k) => fakeFamily(k));
const settings = DEFAULT_LONG_SHOT_SETTINGS;

describe("buildPuzzle", () => {
  it("uses five distinct families from five distinct sources when all pass", async () => {
    const loader: AnswersLoader = async () => ids(20);
    const { prompts } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(5);
    expect(new Set(prompts.map((p) => p.template_key)).size).toBe(5);
    const sources = prompts.map((p) => families.find((f) => f.key === p.template_key)!.source);
    expect(new Set(sources).size).toBe(5);
  });

  it("never asks one position twice", async () => {
    const positional = TEMPLATE_KEYS.map((k, i) => fakeFamily(k, { source: SOURCES[i % SOURCES.length], position: "QB" }));
    const loader: AnswersLoader = async () => ids(20);
    const { prompts } = await buildPuzzle(fakeCtx(), positional, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(1);
  });

  it("skips a draw that ran inside the memory window", async () => {
    const loader: AnswersLoader = async () => ids(20);
    const first = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    const recentKeys = new Set(first.prompts.map((p) => paramsKey(p.template_key, p.params)));
    const second = await buildPuzzle(fakeCtx({ recentKeys }), families, settings, mulberry32(1), loader, allPool);
    expect(second.prompts).toHaveLength(5);
    for (const p of second.prompts) expect(recentKeys.has(paramsKey(p.template_key, p.params))).toBe(false);
    expect(second.log.some((l) => l.outcome === "recent")).toBe(true);
  });

  it("intersects with the pool before checking bounds", async () => {
    const loader: AnswersLoader = async () => ids(10);
    const pool = new Set(ids(10).filter((id) => id !== "p3"));
    const { prompts } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, pool);
    expect(prompts[0].playerIds).not.toContain("p3");
    expect(prompts[0].playerIds).toHaveLength(9);
  });

  it("moves to the next draw when a set is too small", async () => {
    let call = 0;
    const loader: AnswersLoader = async () => (call++ === 0 ? ids(3) : ids(20));
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(5);
    expect(log[0].outcome).toBe("too_few");
    expect(log[0].template_key).toBe(log[1].template_key);
  });

  it("fails a set over the maximum rather than truncating it", async () => {
    const loader: AnswersLoader = async () => ids(61);
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(0);
    expect(log.every((l) => l.outcome === "too_many")).toBe(true);
  });

  it("loads at most MAX_TRIES_PER_FAMILY sets per family and goes short rather than repeating a family", async () => {
    let passes = 0;
    const loader: AnswersLoader = async () => (passes++ < 2 ? ids(20) : ids(2));
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(2);
    const perFamily = new Map<string, number>();
    for (const l of log.filter((l) => l.answer_count !== null)) perFamily.set(l.template_key, (perFamily.get(l.template_key) ?? 0) + 1);
    for (const n of perFamily.values()) expect(n).toBeLessThanOrEqual(MAX_TRIES_PER_FAMILY);
    expect(new Set(prompts.map((p) => p.template_key)).size).toBe(2);
  });

  it("repeats a family only when fewer than five are enabled, and never the same draw", async () => {
    const s = structuredClone(settings);
    for (const k of TEMPLATE_KEYS) s.templates[k].enabled = false;
    s.templates.game_line.enabled = true;
    s.templates.season_finish.enabled = true;
    const loader: AnswersLoader = async () => ids(20);
    const { prompts } = await buildPuzzle(fakeCtx(), families, s, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(4);
    expect(new Set(prompts.map((p) => paramsKey(p.template_key, p.params))).size).toBe(4);

    // A family with one fixed draw can pass once a day, however many passes run.
    const fixed: TemplateFamily[] = [
      { ...fakeFamily("league_trades", { source: "leagues" }), draws: () => [{ n: 1 }] },
      { ...fakeFamily("market_rank", { source: "market" }), draws: () => [{ n: 2 }] },
    ];
    const { prompts: once } = await buildPuzzle(fakeCtx(), fixed, s2(["league_trades", "market_rank"]), mulberry32(1), loader, allPool);
    expect(once.map((p) => p.template_key).sort()).toEqual(["league_trades", "market_rank"]);
  });

  it("counts a family with no draws as skipped", async () => {
    const withSkip = [fakeFamily("game_line", { skip: true }), ...families.slice(1)];
    const loader: AnswersLoader = async () => ids(2);
    const { log } = await buildPuzzle(fakeCtx(), withSkip, settings, mulberry32(1), loader, allPool);
    expect(log.filter((l) => l.template_key === "game_line")).toEqual([
      { template_key: "game_line", params: null, answer_count: null, outcome: "skipped" },
    ]);
  });

  it("skips disabled families", async () => {
    const s = structuredClone(settings);
    s.templates.game_line.enabled = false;
    const loader: AnswersLoader = async () => ids(20);
    const { log } = await buildPuzzle(fakeCtx(), families, s, mulberry32(1), loader, allPool);
    expect(log.some((l) => l.template_key === "game_line")).toBe(false);
  });

  it("the same seed and salt reproduce the same puzzle", async () => {
    const loader: AnswersLoader = async () => ids(20);
    const a = await buildPuzzle(fakeCtx(), families, settings, mulberry32(seedFor("2026-11-09", 0)), loader, allPool);
    const b = await buildPuzzle(fakeCtx(), families, settings, mulberry32(seedFor("2026-11-09", 0)), loader, allPool);
    expect(a.prompts.map((p) => p.prompt_text)).toEqual(b.prompts.map((p) => p.prompt_text));
    const c = await buildPuzzle(fakeCtx(), families, settings, mulberry32(seedFor("2026-11-09", 1)), loader, allPool);
    expect(c.prompts.map((p) => p.prompt_text)).not.toEqual(a.prompts.map((p) => p.prompt_text));
  });

  it("records a loader error as a failed try", async () => {
    const loader: AnswersLoader = async () => {
      throw new Error("boom");
    };
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(0);
    expect(log[0]).toMatchObject({ outcome: "error", detail: "boom" });
  });
});

describe("paramsKey", () => {
  it("does not depend on key order", () => {
    expect(paramsKey("x", { b: 1, a: "y" })).toBe(paramsKey("x", { a: "y", b: 1 }));
  });
});

describe("tierCandidates", () => {
  it("tiers each prompt by band and reports the rate-0 share", () => {
    const prompts = [{ template_key: "game_line" as const, prompt_text: "x", params: {}, playerIds: ids(10) }];
    const rates = new Map(ids(10).slice(5).map((id, i) => [id, (i + 1) / 10]));
    const { answers, rateZeroShare } = tierCandidates(prompts, rates, settings);
    expect(answers[0]).toHaveLength(10);
    expect(rateZeroShare[0]).toBe(0.5);
    expect(answers[0].filter((e) => e.rate === 0).every((e) => e.tier === "long_shot")).toBe(true);
    expect(answers[0].find((e) => e.rate === 0.5)?.tier).toBe("field");
  });
});
