import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { buildPuzzle, tierCandidates, type AnswersLoader } from "./generate";
import { mulberry32, seedFor } from "./random";
import { fakeCtx } from "./templates/test-context";
import type { TemplateFamily } from "./templates/types";
import { TEMPLATE_KEYS, type TemplateKey } from "./types";

/** A family whose draw is a counter, so every draw is a distinct parameter set. */
function fakeFamily(key: TemplateKey, opts: { skip?: boolean } = {}): TemplateFamily {
  return {
    key,
    enabledByDefault: true,
    draw: (rng) => (opts.skip ? null : { n: Math.floor(rng() * 1e9) }),
    text: (params) => `${key} ${String(params.n)}`,
    answers: async () => [],
  };
}

const ids = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const allPool = new Set(ids(500));
const families = TEMPLATE_KEYS.map((k) => fakeFamily(k));
const settings = DEFAULT_LONG_SHOT_SETTINGS;

describe("buildPuzzle", () => {
  it("uses five distinct families when all pass", async () => {
    const loader: AnswersLoader = async () => ids(20);
    const { prompts } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(5);
    expect(new Set(prompts.map((p) => p.template_key)).size).toBe(5);
  });

  it("intersects with the pool before checking bounds", async () => {
    const loader: AnswersLoader = async () => ids(10);
    const pool = new Set(ids(10).filter((id) => id !== "p3"));
    const { prompts } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, pool);
    expect(prompts[0].playerIds).not.toContain("p3");
    expect(prompts[0].playerIds).toHaveLength(9);
  });

  it("redraws when a set is too small", async () => {
    let call = 0;
    const loader: AnswersLoader = async () => (call++ === 0 ? ids(3) : ids(20));
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(5);
    expect(log[0].outcome).toBe("too_few");
  });

  it("fails a set over the maximum rather than truncating it", async () => {
    const loader: AnswersLoader = async () => ids(61);
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(0);
    expect(log.every((l) => l.outcome === "too_many")).toBe(true);
  });

  it("goes short after every family is tried three times", async () => {
    let passes = 0;
    const loader: AnswersLoader = async () => (passes++ < 2 ? ids(20) : ids(2));
    const { prompts, log } = await buildPuzzle(fakeCtx(), families, settings, mulberry32(1), loader, allPool);
    expect(prompts).toHaveLength(2);
    expect(log.length).toBe(TEMPLATE_KEYS.length * 3);
  });

  it("counts a skipped family as tried and never draws it again", async () => {
    const withSkip = [fakeFamily("game_line", { skip: true }), ...families.slice(1)];
    const loader: AnswersLoader = async () => ids(2);
    const { log } = await buildPuzzle(fakeCtx(), withSkip, settings, mulberry32(1), loader, allPool);
    expect(log.filter((l) => l.template_key === "game_line")).toHaveLength(1);
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

describe("tierCandidates", () => {
  it("tiers each prompt and reports the rate-0 share", () => {
    const prompts = [{ template_key: "game_line" as const, prompt_text: "x", params: {}, playerIds: ids(10) }];
    const rates = new Map(ids(10).slice(5).map((id, i) => [id, (i + 1) / 10]));
    const { answers, rateZeroShare } = tierCandidates(prompts, rates, settings);
    expect(answers[0]).toHaveLength(10);
    expect(rateZeroShare[0]).toBe(0.5);
    expect(answers[0].filter((e) => e.rate === 0).every((e) => e.tier === "long_shot")).toBe(true);
  });
});
