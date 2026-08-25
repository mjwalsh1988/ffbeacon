import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchFantasyPlayers, fantasyRelevantPlayerIds } from "./player-search";

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

    const api: Record<string, unknown> = {
      select(columns: string) {
        rec.columns = columns;
        return api;
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    for (const op of ["eq", "or", "in", "gte", "order", "limit", "neq", "lt", "not"]) {
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

  it("escapes wildcards so a query of % does not match everything", async () => {
    await searchFantasyPlayers(client, { query: "50%_off", limit: 10 });
    const playersQuery = recorded.find((r) => r.table === "players");
    const orFilter = playersQuery?.filters.find((f) => f.op === "or");
    expect(String(orFilter?.args[0])).toContain("50\\%\\_off");
  });
});

describe("fantasyRelevantPlayerIds", () => {
  it("asks for nothing when given nothing", async () => {
    const { client, recorded } = makeClient({ players: [], rankedIds: [] });
    const result = await fantasyRelevantPlayerIds(client, []);
    expect(result.size).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it("bounds the read well above PostgREST's 1000-row default", async () => {
    // A broad candidate set matches several thousand raw ranking rows (one per
    // source, format and snapshot). Truncating at the default would silently
    // drop ranked players from search results.
    const { client, recorded } = makeClient({ players: [], rankedIds: ["a"] });
    await fantasyRelevantPlayerIds(client, ["a", "b"]);
    const limit = recorded[0].filters.find((f) => f.op === "limit");
    expect(Number(limit?.args[0])).toBeGreaterThanOrEqual(50000);
  });
});
