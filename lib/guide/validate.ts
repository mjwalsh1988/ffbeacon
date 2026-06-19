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
};

export type ValidatedEntry = {
  kind: GuideEntryKind;
  heading: string;
  body: string;
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

  return { ok: true, value: { kind: input.kind, heading, body } };
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
