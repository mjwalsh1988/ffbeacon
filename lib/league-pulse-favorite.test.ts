/**
 * Tests for the Power Pulse favorite the League Overview rail names.
 *
 * The rules worth pinning down are the ones that decide WHICH team the card
 * points at, and whether it is honest about a tie.
 */

import { describe, expect, it } from "vitest";
import { pickFavorite } from "./league-pulse-favorite";

type Row = Parameters<typeof pickFavorite>[0][number];

function row(overrides: Partial<Row> & { roster_id: string }): Row {
  return {
    power_pulse: 50,
    pulse_rank: null,
    title_odds: null,
    playoff_odds: null,
    projected_wins: null,
    projected_losses: null,
    through_week: 4,
    generated_at: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

describe("pickFavorite", () => {
  it("returns null for a league with no rows", () => {
    expect(pickFavorite([])).toBeNull();
  });

  it("picks the highest title odds, not the highest pulse score", () => {
    // The two legitimately disagree: a team can lead on expected performance
    // and still be an underdog once the bracket is simulated.
    const picked = pickFavorite([
      row({ roster_id: "a", power_pulse: 92, pulse_rank: 1, title_odds: 0.18 }),
      row({ roster_id: "b", power_pulse: 71, pulse_rank: 4, title_odds: 0.29 }),
    ]);
    expect(picked?.row.roster_id).toBe("b");
  });

  it("reports no tie when the favorite is alone", () => {
    const picked = pickFavorite([
      row({ roster_id: "a", title_odds: 0.29 }),
      row({ roster_id: "b", title_odds: 0.18 }),
    ]);
    expect(picked?.tiedWith).toBe(0);
  });

  it("counts a tie on the ROUNDED percentage the card prints", () => {
    // 0.2413 and 0.2409 both read "24%". A card showing a sole favorite beside
    // a number another team also has is the kind of small lie a reader catches.
    const picked = pickFavorite([
      row({ roster_id: "a", title_odds: 0.2413 }),
      row({ roster_id: "b", title_odds: 0.2409 }),
      row({ roster_id: "c", title_odds: 0.11 }),
    ]);
    expect(picked?.row.roster_id).toBe("a");
    expect(picked?.tiedWith).toBe(1);
  });

  it("breaks an exact tie by pulse rank, then by roster id, so it never shuffles", () => {
    const rows = [
      row({ roster_id: "z", title_odds: 0.25, pulse_rank: 2 }),
      row({ roster_id: "a", title_odds: 0.25, pulse_rank: 1 }),
    ];
    expect(pickFavorite(rows)?.row.roster_id).toBe("a");
    expect(pickFavorite([...rows].reverse())?.row.roster_id).toBe("a");
  });

  it("falls back to pulse rank when no row carries title odds", () => {
    // The shape a run produces before a playoff bracket exists.
    const picked = pickFavorite([
      row({ roster_id: "a", power_pulse: 60, pulse_rank: 3 }),
      row({ roster_id: "b", power_pulse: 88, pulse_rank: 1 }),
    ]);
    expect(picked?.row.roster_id).toBe("b");
    expect(picked?.tiedWith).toBe(0);
  });

  it("ignores a stored zero rather than treating it as a real title chance", () => {
    // Every team at 0% is the same "no bracket yet" state, so the fallback
    // should rank on the pulse score rather than pick whichever zero sorted
    // first.
    const picked = pickFavorite([
      row({ roster_id: "a", power_pulse: 40, pulse_rank: 5, title_odds: 0 }),
      row({ roster_id: "b", power_pulse: 90, pulse_rank: 1, title_odds: 0 }),
    ]);
    expect(picked?.row.roster_id).toBe("b");
  });

  it("does not mutate the rows it was given", () => {
    const rows = [
      row({ roster_id: "a", title_odds: 0.1 }),
      row({ roster_id: "b", title_odds: 0.4 }),
    ];
    const before = rows.map((r) => r.roster_id);
    pickFavorite(rows);
    expect(rows.map((r) => r.roster_id)).toEqual(before);
  });
});
