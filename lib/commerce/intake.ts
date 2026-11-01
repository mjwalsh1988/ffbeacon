/**
 * The checkout's input, and the one place the forms' words live.
 *
 * Intake is fixed in code per form: the admin edits product names, prices and
 * features, not the questions. The `team-review` form asks three things; the
 * `trade-review` form asks one, because the trade itself arrives with the order.
 * Safe in a client component.
 */

import { z } from "zod";

export const QUESTIONS_MAX = 1500;
export const OFF_LIMITS_MAX = 500;
export const NOTES_MAX = 1500;

export const TEAM_REVIEW_QUESTIONS = {
  direction: {
    legend: "What are you trying to do this season?",
    options: [
      { value: "contend", label: "Contend" },
      { value: "rebuild", label: "Rebuild" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  questions: {
    label: "What do you want answered?",
    hint: "Trades you are weighing, players you are unsure about, anything you want a straight answer on",
    max: QUESTIONS_MAX,
  },
  offLimits: {
    label: "Anything off the table?",
    hint: "Players you will not trade, picks you are keeping, league rules we should know about",
    max: OFF_LIMITS_MAX,
  },
} as const;

export const TRADE_REVIEW_QUESTIONS = {
  notes: {
    label: "Anything we should know?",
    hint: "Your Sleeper username and league name if you want the trade read against your roster, plus anything about your situation. Leave it blank and we review the trade on its own.",
    max: NOTES_MAX,
  },
} as const;

export const intakeSchema = z.object({
  direction: z.enum(["contend", "rebuild", "unsure"]),
  questions: z.string().trim().max(QUESTIONS_MAX),
  offLimits: z.string().trim().max(OFF_LIMITS_MAX),
});

export type IntakeInput = z.infer<typeof intakeSchema>;

export const tradeIntakeSchema = z.object({
  notes: z.string().trim().max(NOTES_MAX),
});

export type TradeIntakeInput = z.infer<typeof tradeIntakeSchema>;

const orderBase = z.object({
  productSlug: z.string().min(1).max(60),
  paymentMethod: z.enum(["stripe", "paypal", "venmo", "none"]),
  expectedCents: z.number().int().min(0).max(100_000),
  couponCode: z.string().max(24),
});

/** A team review names a league and a roster. `kind` defaults so an older form still parses. */
export const teamReviewOrderSchema = orderBase.extend({
  kind: z.literal("team-review").default("team-review"),
  sleeperLeagueId: z.string().regex(/^\d{1,20}$/),
  rosterId: z.number().int().min(1).max(99),
  sourceSlug: z.string().max(60).nullable().optional(),
  intake: intakeSchema,
});

/** A trade review names the saved Signal Check result by its share id. */
export const tradeReviewOrderSchema = orderBase.extend({
  kind: z.literal("trade-review"),
  shareId: z.string().uuid(),
  intake: tradeIntakeSchema,
});

export const createOrderInputSchema = z.union([tradeReviewOrderSchema, teamReviewOrderSchema]);

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
