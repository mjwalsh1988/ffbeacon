import { describe, it, expect } from "vitest";
import { runSeedRankings, rankingsSeason } from "./seed-rankings";
import { currentNflSeason } from "./sleeper";

/**
 * One thing is under test here: every ranking row this job writes carries a
 * fresh `generated_at`.
 *
 * That column has a now() default, and a default fires only on INSERT. The
 * upsert conflicts on (player_id, format_config_id, source, week, season), so
 * after the first night it UPDATES, and the default never fires again. The
 * column recorded when a player was FIRST ranked rather than when we last
 * ranked them.
 *
 * Three separate features read it as a 90-day "is this player still relevant"
 * window: every search box on the site, the Signal Scout player pool, and the
 * Beacon Brief feed. Measured against production on 2026-08-25, the drift had
 * already hidden 2 players and was on course to hide 158 by 30 September, 712 by
 * 31 October and all 815 by 30 November, while the job ran green every night.
 *
 * A recording fake stands in for PostgREST so the assertion is on the rows the
 * job actually sends, which is where the bug lived.
 */

type Upserted = Record<string, unknown>[];
type Deleted = { table: string; filters: Array<[string, unknown]> }[];

/** Minimal query-builder fake covering only the calls runSeedRankings makes. */
function makeClient(upserted: Upserted, deleted: Deleted = []) {
  const formats = [
    { id: "fmt-dynasty", slug: "dynasty-ppr-sflex" },
  ];
  const sources = [
    {
      slug: "ktc",
      data_type: ["player_value_history"],
      supported_format_slugs: ["dynasty-ppr-sflex"],
    },
  ];
  const history = [
    {
      player_id: "player-a",
      value: 9000,
      captured_at: "2026-08-25T07:00:00.000Z",
      players: { position: "WR" },
    },
    {
      player_id: "player-b",
      value: 5000,
      captured_at: "2026-08-25T07:00:00.000Z",
      players: { position: "RB" },
    },
  ];

  function builder(table: string) {
    let deleting = false;
    const filters: Array<[string, unknown]> = [];

    const api: Record<string, unknown> = {
      select() {
        // A select() that terminates a delete resolves with the removed rows.
        if (deleting) {
          deleted.push({ table, filters });
          return Promise.resolve({ data: [], error: null });
        }
        return api;
      },
      delete() {
        deleting = true;
        return api;
      },
      upsert(rows: Upserted) {
        upserted.push(...rows);
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        const data =
          table === "format_configs" ? formats : table === "source_registry" ? sources : history;
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    for (const op of ["eq", "in", "gte", "lte", "order", "limit", "not", "is", "range", "neq"]) {
      api[op] = (col: string, val: unknown) => {
        filters.push([`${op}:${col}`, val]);
        return api;
      };
    }
    return api;
  }

  return { from: (table: string) => builder(table) } as never;
}

describe("runSeedRankings", () => {
  it("stamps generated_at on every row it writes", async () => {
    // The regression guard. Leaving this to the column default means the
    // timestamp only ever records the first night a player appeared.
    const upserted: Upserted = [];
    const before = Date.now();
    await runSeedRankings(makeClient(upserted));

    expect(upserted.length).toBeGreaterThan(0);
    for (const row of upserted) {
      const stamped = row.generated_at;
      expect(stamped, "a ranking row was written with no generated_at").toBeTruthy();
      const ms = new Date(String(stamped)).getTime();
      expect(Number.isFinite(ms)).toBe(true);
      // Written during this run, not inherited from whenever the row was born.
      expect(ms).toBeGreaterThanOrEqual(before - 1000);
      expect(ms).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it("gives every row in one run the same timestamp", async () => {
    // One run is one snapshot. Rows drifting apart inside a single run would
    // make a relevance window cut through the middle of it.
    const upserted: Upserted = [];
    await runSeedRankings(makeClient(upserted));
    const stamps = new Set(upserted.map((r) => String(r.generated_at)));
    expect(stamps.size).toBe(1);
  });

  it("still ranks by value descending", async () => {
    // Guards the assertion above from passing on a job that has stopped doing
    // its actual work.
    const upserted: Upserted = [];
    await runSeedRankings(makeClient(upserted));
    const byRank = [...upserted].sort(
      (a, b) => Number(a.overall_rank) - Number(b.overall_rank),
    );
    expect(byRank[0].player_id).toBe("player-a");
    expect(byRank[byRank.length - 1].player_id).toBe("player-b");
  });
});

describe("the season is derived, not typed in", () => {
  it("uses the live NFL season rather than a constant", () => {
    // It was `const SEASON = 2025` in three files while the site ran the 2026
    // season. It worked only because writer and readers agreed on the same
    // wrong number, and bumping one without the others would have served a
    // frozen board forever with no error.
    expect(rankingsSeason()).toBe(Number(currentNflSeason()));
  });

  it("stamps every row with that season", async () => {
    const upserted: Upserted = [];
    await runSeedRankings(makeClient(upserted));
    const seasons = new Set(upserted.map((r) => r.season));
    expect(seasons).toEqual(new Set([rankingsSeason()]));
  });

  it("removes rows belonging to any other season", async () => {
    // The table holds exactly one season, which is what lets the readers drop
    // their season filter entirely. Orphans left behind would keep counting
    // toward the 90-day relevance window long after nothing wrote them.
    const upserted: Upserted = [];
    const deleted: Deleted = [];
    await runSeedRankings(makeClient(upserted, deleted));
    const sweep = deleted.find((d) => d.table === "rankings");
    expect(sweep, "no sweep of previous seasons ran").toBeTruthy();
    expect(sweep!.filters).toContainEqual(["neq:season", rankingsSeason()]);
  });
});
