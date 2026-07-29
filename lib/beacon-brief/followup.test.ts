import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the follow-up candidate loader and matcher.
 *
 * The point of interest is the worker's late duplicate guard, which passes
 * articleCreatedAfter so it sees exactly the articles curation could not have seen.
 * These tests drive loadFollowupCandidates against a hand-rolled Supabase stub that
 * records the filters applied, because the filters ARE the behaviour: getting the
 * status filter or the created_at bound wrong is how a duplicate slips through or a
 * live article gets mangled.
 */

// runStructuredCall talks to the Anthropic API. Stub it before importing the module
// under test so no network call is ever attempted.
const runStructuredCall = vi.fn();
vi.mock("./ai", () => ({
  runStructuredCall: (...args: unknown[]) => runStructuredCall(...args),
  logBeaconBrief: vi.fn(async () => {}),
}));

const { loadFollowupCandidates, findFollowupTarget } = await import(
  "./followup"
);

type Filter = { op: string; column: string; value: unknown };

/** One chainable PostgREST-ish query that records what was asked of it. */
function query(rows: unknown[], log: { table: string; filters: Filter[] }[]) {
  const entry = log[log.length - 1];
  const api: Record<string, unknown> = {};
  const chain = (op: string) => (column: string, value?: unknown) => {
    entry.filters.push({ op, column, value });
    return api;
  };
  Object.assign(api, {
    select: chain("select"),
    eq: chain("eq"),
    neq: chain("neq"),
    gt: chain("gt"),
    gte: chain("gte"),
    not: (column: string, op: string, value: unknown) => {
      entry.filters.push({ op: `not.${op}`, column, value });
      return api;
    },
    in: chain("in"),
    order: chain("order"),
    limit: chain("limit"),
    then: (resolve: (v: { data: unknown[] }) => unknown) =>
      resolve({ data: rows }),
  });
  return api;
}

/** Stub admin client returning a canned row set per table. */
function stubAdmin(byTable: Record<string, unknown[]>) {
  const log: { table: string; filters: Filter[] }[] = [];
  const admin = {
    from(table: string) {
      log.push({ table, filters: [] });
      return query(byTable[table] ?? [], log);
    },
  };
  return { admin: admin as never, log };
}

// Only the three fields findFollowupTarget actually reads. Kept untyped so tests can
// vary one field without fighting the full BeaconBriefSettings shape.
const baseSettings = {
  modelTriage: "claude-haiku-4-5",
  followupLookbackDays: 3,
  prompts: { followupLink: "decide if this is a follow-up" },
};
const settings = baseSettings as never;

beforeEach(() => {
  runStructuredCall.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T19:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadFollowupCandidates", () => {
  it("returns one candidate per article, newest ingestion first", async () => {
    const { admin } = stubAdmin({
      news_ingestions: [
        { id: "ing-3", article_id: "art-b" },
        { id: "ing-2", article_id: "art-a" },
        { id: "ing-1", article_id: "art-a" },
      ],
      articles: [
        { id: "art-a", title: "Brissett deal", tl_dr: "terms agreed" },
        { id: "art-b", title: "Gold suspended", tl_dr: "indefinite" },
      ],
    });

    const out = await loadFollowupCandidates(admin, {
      sourceId: "src-1",
      lookbackDays: 3,
    });

    // art-a appears once, carrying its NEWEST ingestion (ing-2, not ing-1).
    expect(out).toEqual([
      {
        ingestion_id: "ing-3",
        article_id: "art-b",
        title: "Gold suspended",
        summary: "indefinite",
      },
      {
        ingestion_id: "ing-2",
        article_id: "art-a",
        title: "Brissett deal",
        summary: "terms agreed",
      },
    ]);
  });

  it("never offers an archived article as a merge target", async () => {
    const { admin, log } = stubAdmin({
      news_ingestions: [{ id: "ing-1", article_id: "art-a" }],
      articles: [],
    });

    const out = await loadFollowupCandidates(admin, {
      sourceId: "src-1",
      lookbackDays: 3,
    });

    expect(out).toEqual([]);
    const articlesQuery = log.find((l) => l.table === "articles");
    expect(articlesQuery?.filters).toEqual(
      expect.arrayContaining([
        { op: "in", column: "status", value: ["published", "draft"] },
      ]),
    );
  });

  it("excludes the post's own ingestion and bounds articles by created_at", async () => {
    const { admin, log } = stubAdmin({
      news_ingestions: [{ id: "sibling", article_id: "art-a" }],
      articles: [{ id: "art-a", title: "t", tl_dr: "s" }],
    });

    await loadFollowupCandidates(admin, {
      sourceId: "src-1",
      lookbackDays: 3,
      excludeIngestionId: "self",
      articleCreatedAfter: "2026-07-26T18:44:00.000Z",
    });

    const ingestionsQuery = log.find((l) => l.table === "news_ingestions");
    expect(ingestionsQuery?.filters).toEqual(
      expect.arrayContaining([
        { op: "neq", column: "id", value: "self" },
        { op: "not.is", column: "article_id", value: null },
        { op: "eq", column: "source_id", value: "src-1" },
      ]),
    );

    // The late-check bound: only articles that did not exist when this post was
    // curated. Anything older was already offered to the curate-time matcher.
    const articlesQuery = log.find((l) => l.table === "articles");
    expect(articlesQuery?.filters).toEqual(
      expect.arrayContaining([
        {
          op: "gt",
          column: "created_at",
          value: "2026-07-26T18:44:00.000Z",
        },
      ]),
    );
  });

  it("omits the created_at bound when no articleCreatedAfter is given", async () => {
    const { admin, log } = stubAdmin({
      news_ingestions: [{ id: "ing-1", article_id: "art-a" }],
      articles: [{ id: "art-a", title: "t", tl_dr: "s" }],
    });

    await loadFollowupCandidates(admin, { sourceId: "src-1", lookbackDays: 3 });

    const articlesQuery = log.find((l) => l.table === "articles");
    expect(
      articlesQuery?.filters.some(
        (f) => f.op === "gt" && f.column === "created_at",
      ),
    ).toBe(false);
  });

  it("applies the lookback window to the ingestion query", async () => {
    const { admin, log } = stubAdmin({ news_ingestions: [] });

    await loadFollowupCandidates(admin, { sourceId: "src-1", lookbackDays: 3 });

    const ingestionsQuery = log.find((l) => l.table === "news_ingestions");
    expect(ingestionsQuery?.filters).toEqual(
      expect.arrayContaining([
        {
          op: "gte",
          column: "created_at",
          value: "2026-07-23T19:00:00.000Z",
        },
      ]),
    );
  });

  it("skips the articles query entirely when no ingestion has an article", async () => {
    const { admin, log } = stubAdmin({ news_ingestions: [] });

    const out = await loadFollowupCandidates(admin, {
      sourceId: "src-1",
      lookbackDays: 3,
    });

    expect(out).toEqual([]);
    expect(log.some((l) => l.table === "articles")).toBe(false);
  });
});

describe("findFollowupTarget", () => {
  const candidates = [
    { ingestion_id: "ing-1", article_id: "art-a", title: "A", summary: "a" },
    { ingestion_id: "ing-2", article_id: "art-b", title: "B", summary: "b" },
  ];

  it("returns the matched candidate", async () => {
    runStructuredCall.mockResolvedValue({ matched_article_id: "art-b" });

    const hit = await findFollowupTarget({
      admin: {} as never,
      settings,
      post: { text: "same event, second reporter" },
      candidates,
    });

    expect(hit).toEqual(candidates[1]);
  });

  it("returns null when the model declines", async () => {
    runStructuredCall.mockResolvedValue({ matched_article_id: "" });

    const hit = await findFollowupTarget({
      admin: {} as never,
      settings,
      post: {},
      candidates,
    });

    expect(hit).toBeNull();
  });

  it("returns null when the model names an id it was not offered", async () => {
    // Guards against a hallucinated id silently rewriting an unrelated article.
    runStructuredCall.mockResolvedValue({ matched_article_id: "art-zzz" });

    const hit = await findFollowupTarget({
      admin: {} as never,
      settings,
      post: {},
      candidates,
    });

    expect(hit).toBeNull();
  });

  it("returns null and makes no AI call when there are no candidates", async () => {
    const hit = await findFollowupTarget({
      admin: {} as never,
      settings,
      post: {},
      candidates: [],
    });

    expect(hit).toBeNull();
    expect(runStructuredCall).not.toHaveBeenCalled();
  });

  it("returns null and makes no AI call when the prompt is unset", async () => {
    const hit = await findFollowupTarget({
      admin: {} as never,
      settings: { ...baseSettings, prompts: { followupLink: "" } } as never,
      post: {},
      candidates,
    });

    expect(hit).toBeNull();
    expect(runStructuredCall).not.toHaveBeenCalled();
  });

  it("treats a failed AI call as no match rather than losing the post", async () => {
    runStructuredCall.mockResolvedValue(null);

    const hit = await findFollowupTarget({
      admin: {} as never,
      settings,
      post: {},
      candidates,
    });

    expect(hit).toBeNull();
  });
});
