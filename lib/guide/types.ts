/**
 * Shared types for the Signal Guide (per-page help system).
 *
 * `GuidePage` is one row of the page registry (guide_pages). `GuideEntry` is one
 * question or term (guide_entries). The public panel and the admin manager both
 * speak these shapes; the DB row types live in lib/database.types.ts.
 */

export type GuideEntryKind = "question" | "term";

export type GuidePage = {
  id: string;
  page_key: string;
  title: string;
  description: string | null;
  route_example: string | null;
  display_order: number;
};

export type GuideEntry = {
  id: string;
  page_id: string;
  kind: GuideEntryKind;
  heading: string;
  body: string;
  display_order: number;
  is_published: boolean;
};

/** What the public panel needs: page meta plus its published entries split by kind. */
export type GuidePageContent = {
  page: GuidePage;
  questions: GuideEntry[];
  terms: GuideEntry[];
};

/** Section copy is fixed product language, kept in one place. */
export const GUIDE_SECTION_LABEL: Record<GuideEntryKind, string> = {
  question: "Understand the Signal",
  term: "Metrics & Terms Decoded",
};

/** Singular noun for a kind, used in admin counts and announcements. */
export const GUIDE_KIND_NOUN: Record<GuideEntryKind, { one: string; many: string }> = {
  question: { one: "question", many: "questions" },
  term: { one: "term", many: "terms" },
};
