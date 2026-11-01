import { describe, expect, it } from "vitest";
import { createOrderInputSchema, intakeSchema, tradeIntakeSchema } from "./intake";

const TRADE = {
  kind: "trade-review",
  productSlug: "trade-review",
  shareId: "0b4f2a6e-5c1d-4e8a-9f3b-2d7c8e1a4b5f",
  paymentMethod: "stripe",
  expectedCents: 395,
  couponCode: "",
  intake: { notes: " @handle, The League " },
};

const INTAKE = { direction: "contend", questions: "", offLimits: "" };
const VALID = {
  productSlug: "team-review-basic",
  sleeperLeagueId: "1234567890",
  rosterId: 3,
  paymentMethod: "stripe",
  expectedCents: 995,
  couponCode: "",
  intake: INTAKE,
};

describe("intakeSchema", () => {
  it("trims both answers", () => {
    expect(
      intakeSchema.parse({ direction: "unsure", questions: "  why? ", offLimits: " none " }),
    ).toEqual({ direction: "unsure", questions: "why?", offLimits: "none" });
  });

  it("refuses a direction outside the three", () => {
    expect(intakeSchema.safeParse({ ...INTAKE, direction: "tank" }).success).toBe(false);
  });

  it("refuses a 1501-character question and takes 1500", () => {
    expect(intakeSchema.safeParse({ ...INTAKE, questions: "x".repeat(1501) }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...INTAKE, questions: "x".repeat(1500) }).success).toBe(true);
  });

  it("caps the off limits answer", () => {
    expect(intakeSchema.safeParse({ ...INTAKE, offLimits: "x".repeat(501) }).success).toBe(false);
  });
});

describe("tradeIntakeSchema", () => {
  it("trims the note and caps it", () => {
    expect(tradeIntakeSchema.parse({ notes: "  hi " })).toEqual({ notes: "hi" });
    expect(tradeIntakeSchema.safeParse({ notes: "x".repeat(1501) }).success).toBe(false);
    expect(tradeIntakeSchema.safeParse({ notes: "" }).success).toBe(true);
  });
});

describe("createOrderInputSchema", () => {
  it("reads an order with no kind as a team review", () => {
    const parsed = createOrderInputSchema.parse(VALID);
    expect(parsed.kind).toBe("team-review");
  });

  it("accepts a trade review by share id and trims its note", () => {
    const parsed = createOrderInputSchema.safeParse(TRADE);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "trade-review") {
      expect(parsed.data.intake.notes).toBe("@handle, The League");
    }
  });

  it("refuses a trade review whose share id is not a uuid, or that carries a roster", () => {
    expect(createOrderInputSchema.safeParse({ ...TRADE, shareId: "abc" }).success).toBe(false);
    expect(
      createOrderInputSchema.safeParse({ ...TRADE, intake: { direction: "contend", questions: "", offLimits: "" } })
        .success,
    ).toBe(false);
  });

  it("accepts a valid order, and method none", () => {
    expect(createOrderInputSchema.safeParse(VALID).success).toBe(true);
    expect(
      createOrderInputSchema.safeParse({ ...VALID, paymentMethod: "none", expectedCents: 0 })
        .success,
    ).toBe(true);
  });

  it("refuses a league id that is not digits and a roster out of range", () => {
    expect(createOrderInputSchema.safeParse({ ...VALID, sleeperLeagueId: "abc" }).success).toBe(
      false,
    );
    expect(createOrderInputSchema.safeParse({ ...VALID, rosterId: 100 }).success).toBe(false);
  });

  it("refuses a method a browser should never post", () => {
    expect(
      createOrderInputSchema.safeParse({ ...VALID, paymentMethod: "complimentary" }).success,
    ).toBe(false);
  });
});
