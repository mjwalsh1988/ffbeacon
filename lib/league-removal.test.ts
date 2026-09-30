import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sleeper", () => ({
  lookupSleeperLeague: vi.fn(),
}));

import {
  checkLeagueStillMissing,
  decideNotFound,
  handleSleeperLeagueNotFound,
  LEAGUE_NOT_FOUND_ERROR,
  LEAGUE_REMOVAL_CONFIRM_MS,
} from "./league-removal";
import { lookupSleeperLeague } from "@/lib/sleeper";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const HOUR = LEAGUE_REMOVAL_CONFIRM_MS;
const iso = (ms: number) => new Date(ms).toISOString();

describe("decideNotFound", () => {
  it("records a first sighting when there is none", () => {
    expect(decideNotFound({ sleeperMissingSince: null, lastPulsedAt: null }, NOW)).toBe(
      "record_first_sighting",
    );
  });

  it("waits while the first sighting is under an hour old", () => {
    expect(
      decideNotFound({ sleeperMissingSince: iso(NOW - HOUR + 1000), lastPulsedAt: null }, NOW),
    ).toBe("wait");
  });

  it("deletes on a second answer at least an hour after the first", () => {
    expect(decideNotFound({ sleeperMissingSince: iso(NOW - HOUR), lastPulsedAt: null }, NOW)).toBe(
      "delete",
    );
  });

  it("starts over when the league synced successfully after the first sighting", () => {
    expect(
      decideNotFound(
        { sleeperMissingSince: iso(NOW - 3 * HOUR), lastPulsedAt: iso(NOW - 2 * HOUR) },
        NOW,
      ),
    ).toBe("record_first_sighting");
  });
});

/**
 * A fake client that records every write, and whose leagues read returns the
 * row given (or an error, standing in for the column not existing before
 * migration 0317).
 */
function fakeClient(opts: { row?: Record<string, unknown> | null; readError?: string } = {}) {
  const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
  const chain = (table: string, op: string, payload?: unknown) => {
    writes.push({ table, op, payload });
    const result = Promise.resolve({ error: null });
    const c = {
      eq: () => c,
      then: result.then.bind(result),
    };
    return c;
  };
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              opts.readError
                ? { data: null, error: { message: opts.readError } }
                : { data: opts.row ?? null, error: null },
            ),
        }),
      }),
      update: (payload: unknown) => chain(table, "update", payload),
      delete: () => chain(table, "delete"),
    }),
  };
  return { client: client as never, writes };
}

const LEAGUE = { id: "row-1", sleeper_league_id: "999" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("handleSleeperLeagueNotFound", () => {
  it("never deletes on a first sighting, and records it", async () => {
    const { client, writes } = fakeClient({ row: { sleeper_missing_since: null, last_pulsed_at: null } });

    const result = await handleSleeperLeagueNotFound(client, LEAGUE, NOW);

    expect(result.outcome).toBe("first_sighting");
    expect(writes.some((w) => w.op === "delete")).toBe(false);
    expect(writes).toContainEqual({
      table: "leagues",
      op: "update",
      payload: { sleeper_missing_since: iso(NOW) },
    });
    expect(
      writes.some(
        (w) => (w.payload as { pulse_error?: string } | undefined)?.pulse_error === LEAGUE_NOT_FOUND_ERROR,
      ),
    ).toBe(true);
  });

  it("deletes the league and its unkeyed side rows on a confirmed second sighting", async () => {
    const { client, writes } = fakeClient({
      row: { sleeper_missing_since: iso(NOW - 2 * HOUR), last_pulsed_at: iso(NOW - 3 * HOUR) },
    });

    const result = await handleSleeperLeagueNotFound(client, LEAGUE, NOW);

    expect(result.outcome).toBe("deleted");
    const deleted = writes.filter((w) => w.op === "delete").map((w) => w.table);
    expect(deleted).toEqual(
      expect.arrayContaining([
        "draft_selections",
        "on_the_clock_draft_cache",
        "trade_suggestion_declines",
        "leagues",
      ]),
    );
    // The league row goes last, so a side-table failure leaves the retry in place.
    expect(deleted[deleted.length - 1]).toBe("leagues");
    // Pending jobs are closed, not deleted.
    expect(writes).toContainEqual(
      expect.objectContaining({ table: "league_sync_jobs", op: "update" }),
    );
  });

  it("deletes nothing when the sighting column cannot be read (before migration 0317)", async () => {
    const { client, writes } = fakeClient({ readError: "column does not exist" });

    const result = await handleSleeperLeagueNotFound(client, LEAGUE, NOW);

    expect(result.outcome).toBe("error");
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });
});

describe("checkLeagueStillMissing", () => {
  it("a failed request touches nothing", async () => {
    vi.mocked(lookupSleeperLeague).mockResolvedValue({ status: "failed" });
    const { client, writes } = fakeClient();

    expect(await checkLeagueStillMissing(client, LEAGUE, NOW)).toEqual({ status: "failed" });
    expect(writes).toEqual([]);
  });

  it("a league Sleeper serves again loses its not-found error and its sighting", async () => {
    vi.mocked(lookupSleeperLeague).mockResolvedValue({
      status: "found",
      league: { league_id: "999" } as never,
    });
    const { client, writes } = fakeClient();

    expect((await checkLeagueStillMissing(client, LEAGUE, NOW)).status).toBe("found");
    expect(writes).toContainEqual({
      table: "leagues",
      op: "update",
      payload: { sleeper_missing_since: null },
    });
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });
});
