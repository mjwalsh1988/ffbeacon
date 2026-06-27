import { describe, it, expect } from "vitest";
import {
  loadRankedBoard,
  toDraftPosition,
  deriveIsRookie,
  ageFromBirthDate,
} from "./board-loader";

// --- Pure helpers -----------------------------------------------------------

describe("toDraftPosition", () => {
  it("keeps the six draftable buckets and maps DST/PK", () => {
    expect(toDraftPosition("QB")).toBe("QB");
    expect(toDraftPosition("def")).toBe("DEF");
    expect(toDraftPosition("DST")).toBe("DEF");
    expect(toDraftPosition("PK")).toBe("K");
    expect(toDraftPosition("K")).toBe("K");
  });
  it("drops non-draftable (IDP / unknown) positions", () => {
    expect(toDraftPosition("LB")).toBeNull();
    expect(toDraftPosition("CB")).toBeNull();
    expect(toDraftPosition(null)).toBeNull();
  });
});

describe("deriveIsRookie", () => {
  it("uses years_experience === 0 as the source of truth", () => {
    expect(deriveIsRookie(0, 2020, 2026)).toBe(true);
    expect(deriveIsRookie(3, 2026, 2026)).toBe(false);
  });
  it("falls back to draft_year === rookieSeason when years_experience is null", () => {
    expect(deriveIsRookie(null, 2026, 2026)).toBe(true);
    expect(deriveIsRookie(null, 2024, 2026)).toBe(false);
    expect(deriveIsRookie(null, null, 2026)).toBe(false);
  });
});

describe("ageFromBirthDate", () => {
  it("computes whole-year age and ignores bad input", () => {
    expect(ageFromBirthDate("2000-01-01", new Date("2026-06-27"))).toBe(26);
    expect(ageFromBirthDate("2000-12-31", new Date("2026-06-27"))).toBe(25);
    expect(ageFromBirthDate(null, new Date("2026-06-27"))).toBeUndefined();
  });
});

// --- loadRankedBoard with a mocked Supabase chain ---------------------------

/**
 * Minimal chainable Supabase mock. Every builder method returns `this`; the
 * builder is awaitable (then) and exposes maybeSingle(). Results are canned per
 * (table, select) so loadRankedBoard's exact query set resolves. The FF Beacon
 * source row is returned for source_registry. Write methods throw, proving the
 * loader is read-only (no value-pipeline mutation).
 */
function mockSupabase(opts: {
  /** undefined => default active ffbeacon row; null => missing row. */
  sourceRow?: { slug: string; display_name: string; is_active: boolean } | null;
  format: { id: string; slug: string; display_name: string } | null;
  latestSeason: number | null;
  rankings: unknown[];
  values?: { player_id: string; value: number; captured_at: string }[];
  trends?: unknown[];
}) {
  const writeThrow = () => {
    throw new Error("write method called: loader must be read-only");
  };
  const sourceRow =
    opts.sourceRow === undefined
      ? { slug: "ffbeacon", display_name: "FF Beacon", is_active: true }
      : opts.sourceRow;

  function builder(table: string) {
    const state: { selectArg?: string } = {};
    const result = () => {
      if (table === "source_registry") return { data: sourceRow, error: null };
      if (table === "format_configs") return { data: opts.format, error: null };
      if (table === "rankings") {
        if (state.selectArg === "season") {
          return { data: opts.latestSeason == null ? null : { season: opts.latestSeason }, error: null };
        }
        return { data: opts.rankings, error: null };
      }
      if (table === "player_value_history") return { data: opts.values ?? [], error: null };
      if (table === "player_value_trends") return { data: opts.trends ?? [], error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {
      select(arg: string) {
        state.selectArg = arg;
        return b;
      },
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(result()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(res, rej),
      insert: writeThrow,
      update: writeThrow,
      upsert: writeThrow,
      delete: writeThrow,
    };
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => builder(table) } as any;
}

const ROOKIE_SEASON = "2026";
const FMT = { id: "f1", slug: "dynasty-ppr-sflex", display_name: "Dynasty SF" };

describe("loadRankedBoard (source forced to FF Beacon)", () => {
  it("returns source-unavailable when the FF Beacon source row is missing", async () => {
    const supabase = mockSupabase({ sourceRow: null, format: FMT, latestSeason: 2025, rankings: [] });
    const res = await loadRankedBoard(supabase, { formatSlug: FMT.slug, rookieSeason: ROOKIE_SEASON });
    expect(res.status).toBe("source-unavailable");
    expect(res.players).toEqual([]);
    expect(res.sourceSlug).toBe("ffbeacon");
  });

  it("returns no-rankings when FF Beacon has no rows for the format", async () => {
    const supabase = mockSupabase({ format: FMT, latestSeason: null, rankings: [] });
    const res = await loadRankedBoard(supabase, { formatSlug: FMT.slug, rookieSeason: ROOKIE_SEASON });
    expect(res.status).toBe("no-rankings");
    expect(res.sourceActive).toBe(true);
  });

  it("loads the FF Beacon board; values stay current under the latest season label", async () => {
    const supabase = mockSupabase({
      format: FMT,
      latestSeason: 2025, // the fixed board-season partition label
      rankings: [
        {
          overall_rank: 1, position_rank: 1, tier: 1,
          players: {
            id: "p1", first_name: "Ja'Marr", last_name: "Chase", position: "WR",
            team: "CIN", external_ids: { sleeper: "7564" }, draft_year: 2021,
            years_experience: 5, birth_date: "2000-03-01",
          },
        },
      ],
      values: [{ player_id: "p1", value: 9000, captured_at: "2026-06-26T07:00:00Z" }],
    });
    const res = await loadRankedBoard(supabase, { formatSlug: FMT.slug, rookieSeason: ROOKIE_SEASON });
    expect(res.status).toBe("ok");
    expect(res.season).toBe("2025");
    expect(res.sourceSlug).toBe("ffbeacon");
    expect(res.valueSourceSlug).toBe("ffbeacon");
    expect(res.sourceActive).toBe(true);
    expect(res.players[0]).toMatchObject({ playerId: "p1", name: "Ja'Marr Chase", position: "WR", value: 9000 });
  });

  it("still loads the board when ffbeacon is_active=false, flagging sourceActive=false", async () => {
    const supabase = mockSupabase({
      sourceRow: { slug: "ffbeacon", display_name: "FF Beacon", is_active: false },
      format: FMT,
      latestSeason: 2025,
      rankings: [
        { overall_rank: 1, position_rank: 1, tier: 1, players: { id: "p1", first_name: "A", last_name: "B", position: "RB", team: "ATL", external_ids: null, draft_year: 2020, years_experience: 5, birth_date: null } },
      ],
    });
    const res = await loadRankedBoard(supabase, { formatSlug: FMT.slug, rookieSeason: ROOKIE_SEASON });
    expect(res.status).toBe("ok");
    expect(res.sourceActive).toBe(false);
    expect(res.players).toHaveLength(1);
  });

  it("drops IDP positions and keeps K/DEF when FF Beacon ranks them", async () => {
    const supabase = mockSupabase({
      format: FMT,
      latestSeason: 2025,
      rankings: [
        { overall_rank: 1, position_rank: 1, tier: 1, players: { id: "qb", first_name: "Q", last_name: "B", position: "QB", team: "BUF", external_ids: null, draft_year: 2018, years_experience: 8, birth_date: null } },
        { overall_rank: 2, position_rank: 1, tier: 1, players: { id: "k", first_name: "Ka", last_name: "Kr", position: "K", team: "DAL", external_ids: { sleeper: "10937" }, draft_year: 2017, years_experience: 9, birth_date: null } },
        { overall_rank: 3, position_rank: 1, tier: 1, players: { id: "def", first_name: "Buffalo", last_name: "Bills", position: "DEF", team: "BUF", external_ids: { sleeper: "BUF" }, draft_year: null, years_experience: null, birth_date: null } },
        { overall_rank: 4, position_rank: 1, tier: 1, players: { id: "lb", first_name: "Idp", last_name: "Backer", position: "LB", team: "SF", external_ids: null, draft_year: 2019, years_experience: 7, birth_date: null } },
      ],
    });
    const res = await loadRankedBoard(supabase, { formatSlug: FMT.slug, rookieSeason: ROOKIE_SEASON });
    const positions = res.players.map((p) => p.position);
    expect(positions).toContain("K");
    expect(positions).toContain("DEF");
    expect(positions).not.toContain("LB");
    // Sleeper DEF id is the team code; it round-trips to the board player's sleeperId.
    expect(res.players.find((p) => p.position === "DEF")?.sleeperId).toBe("BUF");
  });
});
