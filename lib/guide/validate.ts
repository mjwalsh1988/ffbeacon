/**
 * Validation for admin Signal Guide writes. Mirrors the DB CHECK constraints in
 * migration 0078 so the server actions return friendly messages before hitting
 * the database. Heading and body are trimmed; both are required.
 */

import type { GuideEntryKind } from "./types";

export const GUIDE_HEADING_MAX = 200;
export const GUIDE_BODY_MAX = 5000;
export const GUIDE_PAGE_TITLE_MAX = 120;
export const GUIDE_PAGE_DESCRIPTION_MAX = 500;

export type GuideEntryInput = {
  kind: GuideEntryKind;
  heading: string;
  body: string;
  /** Optional; defaults to false (page-specific) when omitted. */
  isGlobal?: boolean;
};

export type ValidatedEntry = {
  kind: GuideEntryKind;
  heading: string;
  body: string;
  isGlobal: boolean;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateEntryInput(input: GuideEntryInput): Result<ValidatedEntry> {
  if (input.kind !== "question" && input.kind !== "term") {
    return { ok: false, error: "Pick whether this is a question or a term." };
  }
  const heading = (input.heading ?? "").trim();
  const body = (input.body ?? "").trim();
  const noun = input.kind === "question" ? "question" : "term";

  if (!heading) {
    return { ok: false, error: `Enter the ${noun}.` };
  }
  if (heading.length > GUIDE_HEADING_MAX) {
    return { ok: false, error: `Keep the ${noun} under ${GUIDE_HEADING_MAX} characters.` };
  }
  if (!body) {
    const what = input.kind === "question" ? "answer" : "explanation";
    return { ok: false, error: `Enter the ${what}.` };
  }
  if (body.length > GUIDE_BODY_MAX) {
    return { ok: false, error: `That content is too long (max ${GUIDE_BODY_MAX} characters).` };
  }

  return {
    ok: true,
    value: { kind: input.kind, heading, body, isGlobal: input.isGlobal === true },
  };
}

// Community question submissions (public intake). Mirrors the CHECK constraints in
// migration 0079 so the submit route returns friendly messages before the insert.
export const GUIDE_SUBMISSION_NAME_MAX = 120;
export const GUIDE_SUBMISSION_EMAIL_MAX = 320;
export const GUIDE_SUBMISSION_QUESTION_MAX = 2000;

// Pragmatic email shape check (not RFC-perfect): one @, a dot in the domain, no
// spaces. Email is optional, so an empty string is valid (treated as "not given").
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidatedSubmission = {
  pageKey: string;
  name: string;
  email: string | null;
  question: string;
};

export function validateSubmissionInput(input: {
  pageKey: unknown;
  name: unknown;
  email: unknown;
  question: unknown;
}): Result<ValidatedSubmission> {
  const pageKey = typeof input.pageKey === "string" ? input.pageKey.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const emailRaw = typeof input.email === "string" ? input.email.trim() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";

  if (!pageKey || pageKey.length > 60 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pageKey)) {
    return { ok: false, error: "We could not tell which page this came from. Please try again." };
  }
  if (!name) {
    return { ok: false, error: "Enter your name so we know who is asking." };
  }
  if (name.length > GUIDE_SUBMISSION_NAME_MAX) {
    return { ok: false, error: `Keep your name under ${GUIDE_SUBMISSION_NAME_MAX} characters.` };
  }
  if (emailRaw && (emailRaw.length > GUIDE_SUBMISSION_EMAIL_MAX || !EMAIL_RE.test(emailRaw))) {
    return { ok: false, error: "That email address does not look right. Leave it blank or fix it." };
  }
  if (!question) {
    return { ok: false, error: "Enter your question." };
  }
  if (question.length > GUIDE_SUBMISSION_QUESTION_MAX) {
    return {
      ok: false,
      error: `Keep your question under ${GUIDE_SUBMISSION_QUESTION_MAX} characters.`,
    };
  }

  return {
    ok: true,
    value: { pageKey, name, email: emailRaw || null, question },
  };
}

export type GuidePageMetaInput = {
  title: string;
  description: string;
};

export function validatePageMeta(
  input: GuidePageMetaInput,
): Result<{ title: string; description: string | null }> {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  if (!title) {
    return { ok: false, error: "Enter a page title." };
  }
  if (title.length > GUIDE_PAGE_TITLE_MAX) {
    return { ok: false, error: `Keep the title under ${GUIDE_PAGE_TITLE_MAX} characters.` };
  }
  if (description.length > GUIDE_PAGE_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `Keep the description under ${GUIDE_PAGE_DESCRIPTION_MAX} characters.`,
    };
  }
  return { ok: true, value: { title, description: description || null } };
}
