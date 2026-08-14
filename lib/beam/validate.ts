/**
 * Input validation for both BEAM endpoints.
 *
 * Mirrors the CHECK constraints in migrations 0196 and 0197, so the routes can
 * return a sentence a person can act on instead of a database error. Same shape
 * and same reasoning as lib/guide/validate.ts, which validates the Signal Guide
 * question form.
 */

import { DEFAULT_BEAM_SETTINGS } from "./default-settings";

export const BEAM_QUESTION_MAX = DEFAULT_BEAM_SETTINGS.limits.maxQuestionLength;
export const BEAM_NAME_MAX = 120;
export const BEAM_EMAIL_MAX = 320;
export const BEAM_MESSAGE_MAX = 1000;

/** Pragmatic shape check, not RFC-perfect. Email is optional throughout. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type ValidatedQuestion = { question: string };

/**
 * The ask endpoint's input.
 *
 * `maxLength` is passed in from settings so an admin can widen or narrow it
 * without a deploy, but the check runs BEFORE anything parses the string, so an
 * oversized body is rejected on length rather than tokenized to find out.
 */
export function validateQuestion(
  raw: unknown,
  maxLength: number = BEAM_QUESTION_MAX,
): Result<ValidatedQuestion> {
  if (typeof raw !== "string") {
    return { ok: false, error: "Ask BEAM a question." };
  }
  const question = raw.trim();
  if (question.length === 0) {
    return { ok: false, error: "Ask BEAM a question." };
  }
  if (question.length > maxLength) {
    return {
      ok: false,
      error: `Keep it under ${maxLength} characters. Shorter questions work better anyway.`,
    };
  }
  return { ok: true, value: { question } };
}

export type ValidatedLearningRequest = {
  queryId: string | null;
  question: string;
  name: string;
  email: string | null;
  message: string | null;
};

export function validateLearningRequest(input: {
  queryId: unknown;
  question: unknown;
  name: unknown;
  email: unknown;
  message: unknown;
}): Result<ValidatedLearningRequest> {
  const queryIdRaw = typeof input.queryId === "string" ? input.queryId.trim() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const emailRaw = typeof input.email === "string" ? input.email.trim() : "";
  const messageRaw = typeof input.message === "string" ? input.message.trim() : "";

  if (queryIdRaw && !UUID_RE.test(queryIdRaw)) {
    return { ok: false, error: "We lost track of which question this was. Please try again." };
  }
  if (!question) {
    return { ok: false, error: "We could not tell which question this was about." };
  }
  if (question.length > BEAM_QUESTION_MAX) {
    return { ok: false, error: "That question is too long to file." };
  }
  if (!name) {
    return { ok: false, error: "Enter your name so we know who is asking." };
  }
  if (name.length > BEAM_NAME_MAX) {
    return { ok: false, error: `Keep your name under ${BEAM_NAME_MAX} characters.` };
  }
  if (emailRaw && (emailRaw.length > BEAM_EMAIL_MAX || !EMAIL_RE.test(emailRaw))) {
    return { ok: false, error: "That email address does not look right. Leave it blank or fix it." };
  }
  if (messageRaw.length > BEAM_MESSAGE_MAX) {
    return { ok: false, error: `Keep your note under ${BEAM_MESSAGE_MAX} characters.` };
  }

  return {
    ok: true,
    value: {
      queryId: queryIdRaw || null,
      question,
      name,
      email: emailRaw || null,
      message: messageRaw || null,
    },
  };
}
