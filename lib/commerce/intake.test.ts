import { describe, expect, it } from "vitest";
import { createOrderInputSchema, intakeSchema } from "./intake";

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

describe("createOrderInputSchema", () => {
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
