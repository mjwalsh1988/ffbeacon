/**
 * The checkout's input, and the one place the form's words live.
 *
 * Intake is fixed in code for the `team-review` form: the admin edits product
 * names, prices and features, not the questions. Safe in a client component.
 */

import { z } from "zod";

export const QUESTIONS_MAX = 1500;
export const OFF_LIMITS_MAX = 500;

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
    hint: "Players you will not trade, picks you are keeping, league rules Michael should know",
    max: OFF_LIMITS_MAX,
  },
} as const;

export const intakeSchema = z.object({
  direction: z.enum(["contend", "rebuild", "unsure"]),
  questions: z.string().trim().max(QUESTIONS_MAX),
  offLimits: z.string().trim().max(OFF_LIMITS_MAX),
});

export type IntakeInput = z.infer<typeof intakeSchema>;

export const createOrderInputSchema = z.object({
  productSlug: z.string().min(1).max(60),
  sleeperLeagueId: z.string().regex(/^\d{1,20}$/),
  rosterId: z.number().int().min(1).max(99),
  paymentMethod: z.enum(["stripe", "paypal", "venmo", "none"]),
  expectedCents: z.number().int().min(0).max(100_000),
  couponCode: z.string().max(24),
  sourceSlug: z.string().max(60).nullable().optional(),
  intake: intakeSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
