import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchFantasyPlayers,
  fantasyRelevantPlayerIds,
  normalizeSearchQuery,
} from "./player-search";
import { bustMemo } from "./memo-ttl";

/**
 * These tests exist to keep one specific mistake from coming back.
 *
 * searchFantasyPlayers used to filter `players.status = 'active'`. That column
 * is Sleeper's ROSTER state, not a statement about whether a player exists, and
 * a player on injured reserve is off the active 53 and reads "Inactive". So the
 * filter deleted 28 currently-ranked real players from every search surface on
 * the site, Ricky Pearsall and Jayden Higgins among them, the moment the player
 * dimension was synced accurately for the first time since May.
 *
 * The assertions below are about the QUERY the function builds, because that is
 * where the bug lived. A recorded query builder stands in for PostgREST.
 */

type Recorded = {
  table: string;
  columns: string;
  filters: Array<{ op: string; args: unknown[] }>;
};

/**
 * Minimal stand-in for the Supabase query builder. Records every filter applied
 * so a test can assert on the shape of the query rather than on a mocked result.
 */
function makeClient(opts: {
  players: Array<{ id: string; full_name: string; position: string; status: string }>;
  rankedIds: string[];
}) {
  const recorded: Recorded[] = [];

  function builder(table: string) {
    const rec: Recorded = { table, columns: "", filters: [] };
    recorded.push(rec);

    const rows =
      table === "players"
        ? opts.players.map((p) => ({
            id: p.id,
            slug: p.full_name.toLowerCase().replace(/\s+/g, "-"),
            first_name: p.full_name.split(" ")[0],
            last_name: p.full_name.split(" ").slice(1).join(" "),
            full_name: p.full_name,
            position: p.position,
            team: null,
            external_ids: null,
          }))
        : opts.rankedIds.map((id) => ({ player_id: id }));

    // A range, when one is applied, so a paged read can be exercised. The real
    // PostgREST caps every page at max-rows (1,000 on this project) whatever
    // limit is asked for, which is the whole reason the paging exists.
    let from = 0;
    let to = Number.MAX_SAFE_INTEGER;

    const api: Record<string, unknown> = {
      select(columns: string) {
        rec.columns = columns;
        return api;
      },
      range(f: number, t: number) {
        from = f;
        to = t;
        rec.filters.push({ op: "range", args: [f, t] });
        return api;
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        const page = rows.slice(from, Math.min(to + 1, rows.length));
        return Promise.resolve(resolve({ data: page, error: null }));
      },
    };
    for (const op of ["eq", "or", "ilike", "in", "gte", "order", "limit", "neq", "lt", "not"]) {
      api[op] = (...args: unknown[]) => {
        rec.filters.push({ op, args });
        return api;
      };
    }
    return api;
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    recorded,
  };
}

const PLAYERS = [
  { id: "p-pearsall", full_name: "Ricky Pearsall", position: "WR", status: "inactive" },
  { id: "p-mahomes", full_name: "Patrick Mahomes", position: "QB", status: "active" },
  { id: "p-retired", full_name: "Adrian Peterson", position: "RB", status: "active" },
];

describe("searchFantasyPlayers", () => {
  let recorded: Recorded[];
  let client: never;

  beforeEach(() => {
    // The ranked-player set is memoised across requests now, so without this
    // the second test in the file is served the first test's answer.
    bustMemo("ref:ranked-ids");
    const made = makeClient({
      players: PLAYERS,
      // Pearsall and Mahomes are ranked. The retired free agent is not, even
      // though Sleeper still calls him active.
      rankedIds: ["p-pearsall", "p-mahomes"],
    });
    recorded = made.recorded;
    client = made.client;
  });

  it("never filters on players.status", async () => {
    // The regression guard. Roster state is not a relevance signal, and using it
    // removes injured players who are exactly the ones people look up.
    await searchFantasyPlayers(client, { query: "pearsall", limit: 10 });
    const playersQuery = recorded.find((r) => r.table === "players");
    const statusFilter = playersQuery?.filters.find(
      (f) => f.op === "eq" && f.args[0] === "status",
    );
    expect(statusFilter, "search filtered on players.status again").toBeUndefined();
  });

  it("returns a ranked player who is on injured reserve", async () => {
    const rows = await searchFantasyPlayers(client, { query: "pearsall", limit: 10 });
    expect(rows.map((r) => r.full_name)).toContain("Ricky Pearsall");
  });

  it("still drops a player no source ranks, however active Sleeper calls him", async () => {
    // The filter that does the real work. Adrian Peterson reads status=active
    // and is not ranked, so he must not surface.
    const rows = await searchFantasyPlayers(client, { query: "peterson", limit: 10 });
    expect(rows.map((r) => r.full_name)).not.toContain("Adrian Peterson");
  });

  it("still constrains to the fantasy positions the caller asked for", async () => {
    await searchFantasyPlayers(client, { query: "x", limit: 10, positions: ["QB"] });
    const playersQuery = recorded.find((r) => r.table === "players");
    const posFilter = playersQuery?.filters.find((f) => f.op === "in" && f.args[0] === "position");
    expect(posFilter?.args[1]).toEqual(["QB"]);
  });

  it("searches one indexed column rather than an OR across three", async () => {
    // The OR had two unindexed arms (first_name, last_name), and one unindexed
    // arm of an OR makes the whole predicate a sequential scan. search_name
    // (migration 0194) carries a trigram index and subsumes all three, because
    // a surname is a substring of "first last".
    await searchFantasyPlayers(client, { query: "pearsall", limit: 10 });
    const playersQuery = recorded.find((r) => r.table === "players");
    expect(playersQuery?.filters.find((f) => f.op === "or")).toBeUndefined();
    const ilike = playersQuery?.filters.find((f) => f.op === "ilike");
    expect(ilike?.args[0]).toBe("search_name");
    expect(String(ilike?.args[1])).toBe("%pearsall%");
  });

  it("keeps a wildcard query from matching everything", async () => {
    await searchFantasyPlayers(client, { query: "50%_off", limit: 10 });
    const playersQuery = recorded.find((r) => r.table === "players");
    const ilike = playersQuery?.filters.find((f) => f.op === "ilike");
    // The normalizer strips % and _ before the escaper sees them, because
    // search_name holds neither character. Either way no wildcard reaches
    // PostgREST as a wildcard, which is the property under test.
    expect(String(ilike?.args[1])).toBe("%50off%");
  });

  it("answers without a query when the search normalizes to nothing", async () => {
    const rows = await searchFantasyPlayers(client, { query: "...", limit: 10 });
    expect(rows).toEqual([]);
    expect(recorded).toHaveLength(0);
  });
});

describe("normalizeSearchQuery", () => {
  it("matches how players.search_name is built", () => {
    // The column is lowercase, alphanumerics and single spaces only. A query
    // that keeps its punctuation is being compared against a column that has
    // none, and matches nobody.
    expect(normalizeSearchQuery("A.J. Brown")).toBe("aj brown");
    expect(normalizeSearchQuery("  St. Brown  ")).toBe("st brown");
    expect(normalizeSearchQuery("Ke'Shawn   Vaughn")).toBe("keshawn vaughn");
    expect(normalizeSearchQuery("!!!")).toBe("");
  });
});

describe("fantasyRelevantPlayerIds", () => {
  it("asks for nothing when given nothing", async () => {
    const { client, recorded } = makeClient({ players: [], rankedIds: [] });
    const result = await fantasyRelevantPlayerIds(client, []);
    expect(result.size).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it("pages past PostgREST's 1000-row cap instead of trusting a high limit", async () => {
    // THE REGRESSION THIS FILE EXISTS FOR, THE SECOND TIME.
    //
    // `rankings` holds one row per (player, format, source), so a few hundred
    // players arrive as thousands of rows. The first version of the ranked-set
    // read asked for them with `.limit(50000)`, on the belief that a high limit
    // overrides PostgREST's default. It does not: Supabase enforces max-rows
    // server-side, the read came back with exactly 1,000 rows covering 519 of
    // 812 players, and the other 293 disappeared from every search box on the
    // site. Kenny Gainwell and Bucky Irving were two of them.
    bustMemo("ref:ranked-ids");
    const rankedIds = Array.from({ length: 2500 }, (_, i) => `p-${i}`);
    const { client, recorded } = makeClient({ players: [], rankedIds });

    const found = await fantasyRelevantPlayerIds(client, [
      "p-0",
      "p-1200",
      "p-2499",
    ]);

    // A player in the third page is still ranked. Under the old read he was not.
    expect(found.has("p-0")).toBe(true);
    expect(found.has("p-1200")).toBe(true);
    expect(found.has("p-2499")).toBe(true);

    // And it got there by paging, not by asking for one enormous page.
    const pages = recorded.filter((r) => r.table === "rankings");
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const range = page.filters.find((f) => f.op === "range");
      expect(range, "every ranked-set read must carry a range").toBeDefined();
      const [start, end] = range!.args as [number, number];
      expect(end - start + 1).toBeLessThanOrEqual(1000);
    }
  });

  it("reads the ranked set once and serves the next caller from memory", async () => {
    bustMemo("ref:ranked-ids");
    const { client, recorded } = makeClient({ players: [], rankedIds: ["a"] });
    await fantasyRelevantPlayerIds(client, ["a"]);
    await fantasyRelevantPlayerIds(client, ["b"]);
    expect(recorded.filter((r) => r.table === "rankings")).toHaveLength(1);
  });

  it("no longer narrows the read to the candidate ids", async () => {
    // It used to send up to 200 uuids per settled keystroke. The answer is the
    // same for every reader, so it is read whole and filtered in memory.
    bustMemo("ref:ranked-ids");
    const { client, recorded } = makeClient({ players: [], rankedIds: ["a"] });
    await fantasyRelevantPlayerIds(client, ["a", "b"]);
    const idFilter = recorded[0].filters.find(
      (f) => f.op === "in" && f.args[0] === "player_id",
    );
    expect(idFilter).toBeUndefined();
  });
});
