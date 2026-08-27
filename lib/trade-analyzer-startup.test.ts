/**
 * The bug, stated as a test.
 *
 * A dynasty startup pick used to be priced from `draft_pick_values`, which holds
 * ROOKIE pick values and only rounds 1 to 4. These cases pin the two failures
 * that produced, using the real numbers from the leagues where they were found:
 *
 *   rounds 1-4   every 2026 first in a 12-team startup priced at the same rookie
 *                bucket, while the players actually taken at those seats ranged
 *                from 6,757 to 10,000.
 *   rounds 5+    no row exists, so the pick priced at zero. One production trade
 *                moved 2026 rounds 12, 13, 14 and 21 and was graded as four
 *                worthless assets.
 */

import { describe, it, expect } from "vitest";
import { analyzeTrade } from "./trade-analyzer";
import type { StartupPickIndex } from "./league-startup-picks";

const FORMAT_ID = "fmt-dynasty-sflex";

/** Values as they really stand for these players in dynasty superflex. */
const VALUES: Record<string, number> = {
  gibbs: 9347,
  taylor: 6757,
  deepGuy: 900,
};

const NAMES: Record<string, { name: string; position: string; sleeper: string }> = {
  gibbs: { name: "Jahmyr Gibbs", position: "RB", sleeper: "9221" },
  taylor: { name: "Jonathan Taylor", position: "RB", sleeper: "6813" },
  deepGuy: { name: "Deep Guy", position: "WR", sleeper: "1111" },
};

/**
 * Supabase stand-in covering the three tables analyzeTrade reads. Pick values
 * deliberately carry ONLY rounds 1 to 4, exactly as production does, so a test
 * that accidentally falls back to them is visible rather than plausible.
 */
function stub() {
  return {
    from(table: string) {
      if (table === "players") {
        const chain = {
          // loadPlayerMeta looks players up BY SLEEPER ID through a PostgREST
          // .or() filter and matches on external_ids.sleeper or the slug tail.
          or: () =>
            Promise.resolve({
              data: Object.entries(NAMES).map(([id, n]) => ({
                id,
                slug: `${id}-${n.sleeper}`,
                full_name: n.name,
                first_name: null,
                last_name: null,
                position: n.position,
                team: "DET",
                external_ids: { sleeper: n.sleeper },
              })),
              error: null,
            }),
          in: (_column: string, ids: string[]) =>
            Promise.resolve({
              data: ids
                .filter((id) => NAMES[id])
                .map((id) => ({
                  id,
                  full_name: NAMES[id].name,
                  first_name: null,
                  last_name: null,
                  position: NAMES[id].position,
                  team: "DET",
                  external_ids: { sleeper: NAMES[id].sleeper },
                })),
              error: null,
            }),
        };
        return { select: () => chain };
      }
      if (table === "player_value_trends") {
        const chain = {
          eq: () => chain,
          in: (_column: string, ids: string[]) =>
            Promise.resolve({
              data: ids
                .filter((id) => VALUES[id] !== undefined)
                .map((id) => ({ player_id: id, current_value: VALUES[id] })),
              error: null,
            }),
        };
        return { select: () => chain };
      }
      if (table === "draft_pick_values") {
        const chain = {
          eq: () => chain,
          order: () =>
            Promise.resolve({
              data: [
                { season: 2026, round: 1, pick_position: "early", value: 6358, captured_at: "t" },
                { season: 2026, round: 1, pick_position: "mid", value: 5354, captured_at: "t" },
                { season: 2026, round: 1, pick_position: "late", value: 4791, captured_at: "t" },
              ],
              error: null,
            }),
        };
        return { select: () => chain };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as Parameters<typeof analyzeTrade>[0];
}

const CONTEXT = {
  formatConfigId: FORMAT_ID,
  formatSlug: "dynasty-ppr-sflex",
  formatDisplay: "Dynasty PPR Superflex",
  sourceSlug: "ffbeacon",
  sourceDisplay: "FF Beacon",
  pickSourceSlug: null,
  pickSourceDisplay: null,
};

const IDENTITIES = {
  5: { teamName: "Team Five", ownerHandle: null },
  7: { teamName: "Team Seven", ownerHandle: null },
};

/** An index that answers for 2026 only, mapping (round, roster) to a player. */
function startupIndex(
  answers: Record<string, { playerId?: string; simulated?: boolean; reason?: string }>,
): StartupPickIndex {
  return {
    hasStartupDraft: true,
    draftForSeason: () => null,
    timingFor: () => "before-draft",
    resolve: ({ season, round, originalRosterId }) => {
      if (season !== 2026) return null;
      const hit = answers[`${round}|${originalRosterId}`];
      if (!hit) return null;
      return {
        substitution: hit.playerId
          ? { kind: "player", playerId: hit.playerId, simulated: hit.simulated ?? false }
          : {
              kind: "unresolved",
              reason: (hit.reason ?? "not-captured") as "not-captured",
            },
        seat: 1,
        pickNo: 1,
        label: `${round}.01`,
        used: !hit.simulated,
        season,
        round,
      };
    },
  };
}

/** One 2026 first each way, the shape of the real King of Kings trade. */
const SWAP_OF_FIRSTS = [
  { season: 2026, round: 1, owner_id: 7, roster_id: 5, previous_owner_id: 5 },
  { season: 2026, round: 1, owner_id: 5, roster_id: 7, previous_owner_id: 7 },
];

describe("analyzeTrade, the bug", () => {
  it("without a startup index, two startup firsts price off the ROOKIE table", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: SWAP_OF_FIRSTS,
      rosterIdentities: IDENTITIES,
      context: CONTEXT,
    }))!;
    // Both land on the same rookie bucket, so the deal grades as perfectly even
    // however far apart the real players are. This is the behavior being fixed.
    const values = analysis.sides.map((s) => s.picks[0].value);
    expect(values).toEqual([5354, 5354]);
    expect(analysis.verdict.label).toBe("Even trade");
  });

  it("with a startup index, each first is worth the player actually drafted", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: SWAP_OF_FIRSTS,
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({
        "1|5": { playerId: "gibbs" },
        "1|7": { playerId: "taylor" },
      }),
      context: CONTEXT,
    }))!;

    const byTeam = Object.fromEntries(
      analysis.sides.map((s) => [s.rosterId, s.picks[0]]),
    );
    expect(byTeam[7].value).toBe(9347);
    expect(byTeam[7].startup?.playerName).toBe("Jahmyr Gibbs");
    expect(byTeam[7].startup?.simulated).toBe(false);
    expect(byTeam[5].value).toBe(6757);
    expect(byTeam[5].startup?.playerName).toBe("Jonathan Taylor");

    // 2,590 points apart on a 9,347 ceiling is 27.7%, comfortably a win.
    expect(analysis.verdict.label).toBe("Won the trade");
    expect(analysis.verdict.winnerRosterId).toBe(7);
  });

  it("prices a round the rookie table does not publish at all", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: [{ season: 2026, round: 12, owner_id: 7, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "12|5": { playerId: "deepGuy" } }),
      context: CONTEXT,
    }))!;
    const pick = analysis.sides[0].picks[0];
    expect(pick.value).toBe(900);
    expect(pick.noValue).toBe(false);
    expect(pick.startup?.playerName).toBe("Deep Guy");
  });

  it("without the index that same round-12 pick is worth nothing", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: [{ season: 2026, round: 12, owner_id: 7, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      context: CONTEXT,
    }))!;
    expect(analysis.sides[0].picks[0].value).toBe(0);
    expect(analysis.sides[0].picks[0].noValue).toBe(true);
  });
});

describe("analyzeTrade, startup edge cases", () => {
  it("marks an unresolvable startup pick as unpriced rather than pricing it as a rookie pick", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: [{ season: 2026, round: 1, owner_id: 7, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "1|5": { reason: "not-captured" } }),
      context: CONTEXT,
    }))!;
    const pick = analysis.sides[0].picks[0];
    // The rookie table HAS a 2026 round 1 row. Falling back to it is the bug,
    // so the value must be zero and the reason must be stated.
    expect(pick.value).toBe(0);
    expect(pick.noValue).toBe(true);
    expect(pick.startup?.unresolvedNote).toContain("not loaded");
    expect(analysis.hasMissingValues).toBe(true);
  });

  it("flags a pick that has not been made yet as a projection", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: [{ season: 2026, round: 1, owner_id: 7, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "1|5": { playerId: "gibbs", simulated: true } }),
      context: CONTEXT,
    }))!;
    expect(analysis.sides[0].picks[0].startup?.simulated).toBe(true);
    expect(analysis.sides[0].picks[0].value).toBe(9347);
  });

  it("counts a player once when the trade moves both him and the pick that drafted him", async () => {
    // A trade made AFTER the draft can carry the drafted player AND the spent
    // pick record. Counting both would add one player's value twice to one side
    // and hand that side a phantom win.
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      // Gibbs himself moves to roster 7.
      adds: { [NAMES.gibbs.sleeper]: 7 },
      // ...and so does the 2026 first that drafted him.
      draftPicks: [{ season: 2026, round: 1, owner_id: 7, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "1|5": { playerId: "gibbs" } }),
      context: CONTEXT,
    }))!;

    const side = analysis.sides.find((s) => s.rosterId === 7)!;
    expect(side.players[0].value).toBe(9347);
    expect(side.picks[0].value).toBe(0);
    // 9,347 once, not 18,694.
    expect(side.totalValue).toBe(9347);
    expect(side.picks[0].startup?.unresolvedNote).toContain("already on this side");
  });

  it("still pays a pick that resolves to a player the OTHER side received", async () => {
    // The duplicate guard is per side. Roster 7 gets Gibbs himself; roster 5
    // gets a pick that happens to resolve to Gibbs. Roster 5's asset is real.
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: { [NAMES.gibbs.sleeper]: 7 },
      draftPicks: [{ season: 2026, round: 1, owner_id: 5, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "1|5": { playerId: "gibbs" } }),
      context: CONTEXT,
    }))!;
    const five = analysis.sides.find((s) => s.rosterId === 5)!;
    expect(five.picks[0].value).toBe(9347);
    expect(five.picks[0].startup?.unresolvedNote).toBeNull();
  });

  it("pays a repeated seat only once", async () => {
    // Two descriptors landing on the same seat would otherwise both be paid.
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: [
        { season: 2026, round: 1, owner_id: 7, roster_id: 5 },
        { season: 2026, round: 1, owner_id: 7, roster_id: 5 },
      ],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "1|5": { playerId: "gibbs" } }),
      context: CONTEXT,
    }))!;
    const seven = analysis.sides.find((s) => s.rosterId === 7)!;
    expect(seven.totalValue).toBe(9347);
    // A deliberate zero is not a missing value, so no "values missing" caveat.
    expect(analysis.hasMissingValues).toBe(false);
  });

  it("leaves a non-startup pick on the rookie table untouched", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      // The index answers for 2026 only, so a 2027 pick is not a startup pick.
      draftPicks: [{ season: 2027, round: 1, owner_id: 7, roster_id: 5, pick_position: "mid" }],
      rosterIdentities: IDENTITIES,
      startupIndex: startupIndex({ "1|5": { playerId: "gibbs" } }),
      context: CONTEXT,
    }))!;
    expect(analysis.sides[0].picks[0].startup).toBeUndefined();
  });

  it("takes the seat from the startup draft rather than the slot index", async () => {
    const analysis = (await analyzeTrade(stub(), {
      leagueRowId: "L",
      adds: null,
      draftPicks: [{ season: 2026, round: 1, owner_id: 7, roster_id: 5 }],
      rosterIdentities: IDENTITIES,
      slotIndex: {
        labelFor: () => "1.09",
        slotFor: () => 9,
        rosterToSlotBySeason: new Map(),
      },
      startupIndex: startupIndex({ "1|5": { playerId: "gibbs" } }),
      context: CONTEXT,
    }))!;
    expect(analysis.sides[0].picks[0].slot).toBe(1);
    expect(analysis.sides[0].picks[0].pickLabel).toBe("1.01");
  });
});
