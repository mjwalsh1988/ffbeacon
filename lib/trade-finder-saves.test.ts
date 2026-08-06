import { describe, it, expect } from "vitest";
import { savedSuggestionSchema, savedGradeSchema, SAVE_LIMITS } from "./trade-finder-saves";

/**
 * The bookmark schema is the only thing standing between a client-supplied
 * object and a jsonb column, so it is tested as a boundary rather than as a
 * type. Every case here is something the column must refuse.
 */

/** The engine's own fingerprint shape: tf1-<roster>-<in>x<out>-<hash>. */
const KEY = "tf1-4-1x1-0a1b2c3d";

const player = (over: Record<string, unknown> = {}) => ({
  kind: "player",
  playerId: "11111111-2222-3333-4444-555555555555",
  sleeperId: "4034",
  name: "A Player",
  position: "RB",
  team: "BUF",
  value: 4200,
  age: 25.4,
  projPoints: 14.2,
  ...over,
});

const impact = () => ({
  valueDelta: 120,
  lineupDelta: 1.4,
  ageDelta: -0.3,
  pickCountDelta: 0,
});

const suggestion = (over: Record<string, unknown> = {}) => ({
  key: KEY,
  counterparty: {
    rosterId: 4,
    teamName: "Rebuild City",
    ownerHandle: "manager4",
    statusLabel: "Rebuilder",
    direction: "rebuild",
  },
  incoming: [player()],
  outgoing: [player({ playerId: "66666666-7777-8888-9999-000000000000" })],
  mine: impact(),
  theirs: impact(),
  valueGap: 0.03,
  qualityRatio: 1.02,
  acceptance: "worth-asking",
  score: 2.4,
  headline: "Their back for your receiver",
  whyYou: "Fills the hole at running back.",
  whyThem: "Gets younger without losing value.",
  pitch: "What do you think of me sending you X for Y?",
  caveats: [],
  ...over,
});

describe("savedSuggestionSchema", () => {
  it("accepts a suggestion the engine would produce", () => {
    expect(savedSuggestionSchema.safeParse(suggestion()).success).toBe(true);
  });

  it("refuses an unknown key, so the column cannot carry a payload", () => {
    const parsed = savedSuggestionSchema.safeParse({
      ...suggestion(),
      smuggled: { anything: "at all" },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown key nested inside an asset", () => {
    const parsed = savedSuggestionSchema.safeParse(
      suggestion({ incoming: [player({ extra: "nope" })] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a fingerprint that is not one", () => {
    expect(savedSuggestionSchema.safeParse(suggestion({ key: "not-a-key" })).success).toBe(
      false,
    );
    expect(savedSuggestionSchema.safeParse(suggestion({ key: "" })).success).toBe(false);
  });

  it("refuses a player id that is not a uuid", () => {
    const parsed = savedSuggestionSchema.safeParse(
      suggestion({ incoming: [player({ playerId: "'; drop table --" })] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("caps how many assets a side may carry", () => {
    const tooMany = Array.from({ length: SAVE_LIMITS.MAX_ASSETS_PER_SIDE + 1 }, (_, i) =>
      player({ playerId: `1111111${i}-2222-3333-4444-555555555555` }),
    );
    expect(savedSuggestionSchema.safeParse(suggestion({ incoming: tooMany })).success).toBe(
      false,
    );
  });

  it("refuses an empty side, because that is not a trade", () => {
    expect(savedSuggestionSchema.safeParse(suggestion({ incoming: [] })).success).toBe(false);
  });

  it("caps free text rather than storing whatever arrives", () => {
    const long = "x".repeat(50_000);
    expect(savedSuggestionSchema.safeParse(suggestion({ pitch: long })).success).toBe(false);
    expect(savedSuggestionSchema.safeParse(suggestion({ headline: long })).success).toBe(
      false,
    );
    expect(
      savedSuggestionSchema.safeParse(
        suggestion({ incoming: [player({ name: long })] }),
      ).success,
    ).toBe(false);
  });

  it("refuses values that are not finite numbers", () => {
    expect(
      savedSuggestionSchema.safeParse(suggestion({ incoming: [player({ value: Infinity })] }))
        .success,
    ).toBe(false);
    expect(
      savedSuggestionSchema.safeParse(suggestion({ incoming: [player({ value: "4200" })] }))
        .success,
    ).toBe(false);
  });

  it("refuses an acceptance band it does not recognise", () => {
    expect(savedSuggestionSchema.safeParse(suggestion({ acceptance: "certain" })).success).toBe(
      false,
    );
  });

  it("accepts a pick asset, and bounds its season and round", () => {
    const pickAsset = {
      kind: "pick",
      key: "pick:2027:1:4",
      label: "2027 1st",
      season: 2027,
      round: 1,
      value: 2500,
    };
    expect(
      savedSuggestionSchema.safeParse(
        suggestion({ key: "tf1-4-1x1-0a1b2c3d", incoming: [pickAsset] }),
      ).success,
    ).toBe(true);
    expect(
      savedSuggestionSchema.safeParse(
        suggestion({ incoming: [{ ...pickAsset, round: 99 }] }),
      ).success,
    ).toBe(false);
    expect(
      savedSuggestionSchema.safeParse(
        suggestion({ incoming: [{ ...pickAsset, season: 1066 }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a caveat list long enough to be a payload", () => {
    const many = Array.from({ length: 40 }, () => "note");
    expect(savedSuggestionSchema.safeParse(suggestion({ caveats: many })).success).toBe(false);
  });
});

describe("savedGradeSchema", () => {
  const grade = (over: Record<string, unknown> = {}) => ({
    verdictLabel: "Side A wins by 4.2% of total trade value.",
    favours: "you",
    confidenceLabel: "Medium confidence",
    tradeShapeLabel: "Consolidation trade",
    explanation: "Side A receives the strongest individual asset in the deal.",
    formatDisplay: "Dynasty Superflex",
    ...over,
  });

  it("accepts a grade the pipeline would produce", () => {
    expect(savedGradeSchema.safeParse(grade()).success).toBe(true);
  });

  it("accepts the nullable labels, because a grade skips them when unsure", () => {
    expect(
      savedGradeSchema.safeParse(grade({ confidenceLabel: null, tradeShapeLabel: null }))
        .success,
    ).toBe(true);
  });

  it("refuses an unknown favours value", () => {
    expect(savedGradeSchema.safeParse(grade({ favours: "everyone" })).success).toBe(false);
  });

  it("refuses an unknown key", () => {
    expect(savedGradeSchema.safeParse({ ...grade(), debug: "x" }).success).toBe(false);
  });
});
