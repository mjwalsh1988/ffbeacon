import { describe, it, expect } from "vitest";
import {
  OBSERVATION_LIMIT_MS,
  diffLeagueSnapshots,
  diffNumericMaps,
  fingerprint,
  type LeagueSnapshot,
} from "./diff";

/**
 * The diff is where this feature can lie.
 *
 * Every case below is one of the ways it could report something that did not
 * happen: a change invented on first sight, a stale comparison dressed up as an
 * observation, a waiver add counted a second time as a lineup decision, or two
 * concurrent syncs writing the same event twice. Each has a test because none
 * of them is reproducible against a live league.
 */

const NOW = "2026-09-16T15:00:00.000Z";
const AN_HOUR_AGO = "2026-09-16T14:00:00.000Z";
const A_MONTH_AGO = "2026-08-16T15:00:00.000Z";

function snapshot(over: Partial<LeagueSnapshot> = {}): LeagueSnapshot {
  return {
    name: "The League",
    status: "in_season",
    totalRosters: 12,
    scoringSettings: { rec: 1, pass_td: 4 },
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"],
    settings: { waiver_type: 2, waiver_budget: 100, trade_deadline: 12 },
    rosters: [
      {
        sleeperRosterId: 1,
        ownerUserId: "u1",
        playerIds: ["100", "200", "300"],
        starterIds: ["100", "200"],
        reserveIds: [],
        taxiIds: [],
      },
      {
        sleeperRosterId: 2,
        ownerUserId: "u2",
        playerIds: ["400"],
        starterIds: ["400"],
        reserveIds: [],
        taxiIds: [],
      },
    ],
    users: [
      {
        sleeperUserId: "u1",
        displayName: "alice",
        teamName: "Alice FC",
        avatar: "aaa",
        isCommissioner: false,
      },
      {
        sleeperUserId: "u2",
        displayName: "bob",
        teamName: null,
        avatar: null,
        isCommissioner: false,
      },
    ],
    drafts: [{ sleeperDraftId: "d1", status: "complete", season: 2026 }],
    ...over,
  };
}

const opts = { now: NOW, observedFrom: AN_HOUR_AGO, season: 2026, week: 2 };

describe("first sight", () => {
  it("emits nothing when there is no prior snapshot", () => {
    expect(diffLeagueSnapshots(null, snapshot(), opts)).toEqual([]);
  });

  it("emits nothing when the league has never completed a sync", () => {
    const before = snapshot();
    const after = snapshot({ name: "Renamed" });
    expect(
      diffLeagueSnapshots(before, after, { ...opts, observedFrom: null }),
    ).toEqual([]);
  });
});

describe("league fields", () => {
  it("reports a rename", () => {
    const events = diffLeagueSnapshots(snapshot(), snapshot({ name: "New Name" }), opts);
    const rename = events.find((e) => e.kind === "league_renamed");
    expect(rename?.payload).toMatchObject({ from: "The League", to: "New Name" });
  });

  it("reports a season phase change", () => {
    const events = diffLeagueSnapshots(snapshot(), snapshot({ status: "complete" }), opts);
    expect(events.find((e) => e.kind === "league_status_change")?.payload).toMatchObject({
      from: "in_season",
      to: "complete",
    });
  });

  it("reports the team count once, not twice", () => {
    // `settings.num_teams` and `total_rosters` are the same fact from two
    // fields. Both moving must still yield one card.
    const before = snapshot({ settings: { num_teams: 12, waiver_type: 2 } });
    const after = snapshot({
      totalRosters: 10,
      settings: { num_teams: 10, waiver_type: 2 },
    });
    const events = diffLeagueSnapshots(before, after, opts);
    expect(events.filter((e) => e.kind === "team_count_change")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "league_setting_change")).toHaveLength(0);
  });
});

describe("scoring and settings", () => {
  it("puts every changed scoring key on one card", () => {
    const after = snapshot({ scoringSettings: { rec: 0.5, pass_td: 6 } });
    const events = diffLeagueSnapshots(snapshot(), after, opts);
    const scoring = events.filter((e) => e.kind === "scoring_change");
    expect(scoring).toHaveLength(1);
    expect((scoring[0].payload as { changes: unknown[] }).changes).toHaveLength(2);
  });

  it("treats a dropped scoring key as a change", () => {
    const after = snapshot({ scoringSettings: { pass_td: 4 } });
    const events = diffLeagueSnapshots(snapshot(), after, opts);
    const changes = (events.find((e) => e.kind === "scoring_change")?.payload as {
      changes: Array<{ key: string; to: unknown }>;
    }).changes;
    expect(changes).toEqual([{ key: "rec", from: 1, to: null }]);
  });

  it("does not report 1 changing to 1.0", () => {
    const after = snapshot({ scoringSettings: { rec: 1.0, pass_td: 4 } });
    expect(
      diffLeagueSnapshots(snapshot(), after, opts).filter((e) => e.kind === "scoring_change"),
    ).toHaveLength(0);
  });

  it("ignores a setting that is not on the whitelist", () => {
    // `leg` is Sleeper's own week counter and moves on its own every week.
    const before = snapshot({ settings: { waiver_type: 2, leg: 1 } });
    const after = snapshot({ settings: { waiver_type: 2, leg: 2 } });
    expect(
      diffLeagueSnapshots(before, after, opts).filter(
        (e) => e.kind === "league_setting_change",
      ),
    ).toHaveLength(0);
  });

  it("reports a whitelisted setting", () => {
    const after = snapshot({
      settings: { waiver_type: 2, waiver_budget: 100, trade_deadline: 10 },
    });
    const changes = (
      diffLeagueSnapshots(snapshot(), after, opts).find(
        (e) => e.kind === "league_setting_change",
      )?.payload as { changes: Array<{ key: string }> }
    ).changes;
    expect(changes.map((c) => c.key)).toEqual(["trade_deadline"]);
  });
});

describe("roster slots", () => {
  it("counts slots as a multiset, so a third receiver is an addition", () => {
    const after = snapshot({
      rosterPositions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "BN", "BN"],
    });
    const payload = diffLeagueSnapshots(snapshot(), after, opts).find(
      (e) => e.kind === "roster_positions_change",
    )?.payload as { added: string[]; removed: string[] };
    expect(payload.added).toEqual(["WR"]);
    expect(payload.removed).toEqual([]);
  });

  it("says nothing when the slots are only reordered", () => {
    const after = snapshot({
      rosterPositions: ["RB", "QB", "WR", "RB", "TE", "WR", "FLEX", "BN", "BN"],
    });
    expect(
      diffLeagueSnapshots(snapshot(), after, opts).filter(
        (e) => e.kind === "roster_positions_change",
      ),
    ).toHaveLength(0);
  });
});

describe("lineups", () => {
  function withLineup(starters: string[], players = ["100", "200", "300"]): LeagueSnapshot {
    const s = snapshot();
    s.rosters[0] = { ...s.rosters[0], starterIds: starters, playerIds: players };
    return s;
  }

  it("reports a swap between two players the roster already held", () => {
    const events = diffLeagueSnapshots(
      withLineup(["100", "200"]),
      withLineup(["100", "300"]),
      opts,
    );
    const payload = events.find((e) => e.kind === "lineup_change")?.payload as {
      started: string[];
      benched: string[];
    };
    expect(payload.started).toEqual(["300"]);
    expect(payload.benched).toEqual(["200"]);
  });

  it("does not report a newly acquired player as a lineup decision", () => {
    // The waiver claim already says "added 999". Reporting it again as a lineup
    // change would give the league two cards for one move.
    const before = withLineup(["100", "200"], ["100", "200", "300"]);
    const after = withLineup(["100", "999"], ["100", "999", "300"]);
    const payload = diffLeagueSnapshots(before, after, opts).find(
      (e) => e.kind === "lineup_change",
    )?.payload as { started: string[]; benched: string[] } | undefined;
    // 200 left the roster entirely, 999 arrived: neither is a lineup decision,
    // so there is nothing to report at all.
    expect(payload).toBeUndefined();
  });

  it("drops lineup events when the observation window is too wide", () => {
    const events = diffLeagueSnapshots(withLineup(["100", "200"]), withLineup(["100", "300"]), {
      ...opts,
      observedFrom: A_MONTH_AGO,
    });
    expect(events.filter((e) => e.kind === "lineup_change")).toHaveLength(0);
  });

  it("keeps lineup events right at the edge of the window", () => {
    const observedFrom = new Date(Date.parse(NOW) - OBSERVATION_LIMIT_MS).toISOString();
    const events = diffLeagueSnapshots(withLineup(["100", "200"]), withLineup(["100", "300"]), {
      ...opts,
      observedFrom,
    });
    expect(events.filter((e) => e.kind === "lineup_change")).toHaveLength(1);
  });

  it("still reports a settings change across a wide window", () => {
    // Unlike a lineup edit, "the trade deadline moved at some point since
    // August" is worth knowing and there is no other record of it.
    const after = snapshot({ settings: { waiver_type: 2, waiver_budget: 100, trade_deadline: 9 } });
    const events = diffLeagueSnapshots(snapshot(), after, {
      ...opts,
      observedFrom: A_MONTH_AGO,
    });
    expect(events.filter((e) => e.kind === "league_setting_change")).toHaveLength(1);
  });
});

describe("reserve and taxi", () => {
  it("reports a move to IR", () => {
    const before = snapshot();
    const after = snapshot();
    after.rosters[0] = { ...after.rosters[0], reserveIds: ["300"] };
    const payload = diffLeagueSnapshots(before, after, opts).find(
      (e) => e.kind === "reserve_move",
    )?.payload as { toReserve: string[] };
    expect(payload.toReserve).toEqual(["300"]);
  });
});

describe("people", () => {
  it("reports a manager joining and the roster changing hands together", () => {
    const before = snapshot();
    const after = snapshot();
    after.users = [
      after.users[0],
      {
        sleeperUserId: "u3",
        displayName: "carol",
        teamName: null,
        avatar: null,
        isCommissioner: false,
      },
    ];
    after.rosters[1] = { ...after.rosters[1], ownerUserId: "u3" };

    const kinds = diffLeagueSnapshots(before, after, opts).map((e) => e.kind);
    expect(kinds).toContain("manager_joined");
    expect(kinds).toContain("manager_left");
    expect(kinds).toContain("roster_owner_change");
  });

  it("reports a team name change without touching the handle", () => {
    const after = snapshot();
    after.users = [{ ...after.users[0], teamName: "Alice United" }, after.users[1]];
    const payload = diffLeagueSnapshots(snapshot(), after, opts).find(
      (e) => e.kind === "team_identity_change",
    )?.payload as { changes: Array<{ key: string }> };
    expect(payload.changes.map((c) => c.key)).toEqual(["team_name"]);
  });

  it("does not treat whitespace as a rename", () => {
    const after = snapshot();
    after.users = [{ ...after.users[0], teamName: "  Alice FC  " }, after.users[1]];
    expect(
      diffLeagueSnapshots(snapshot(), after, opts).filter(
        (e) => e.kind === "team_identity_change",
      ),
    ).toHaveLength(0);
  });
});

describe("drafts", () => {
  it("reports a status change on a draft we already knew about", () => {
    const after = snapshot({
      drafts: [{ sleeperDraftId: "d1", status: "drafting", season: 2026 }],
    });
    expect(
      diffLeagueSnapshots(snapshot(), after, opts).find((e) => e.kind === "draft_status_change")
        ?.payload,
    ).toMatchObject({ from: "complete", to: "drafting" });
  });

  it("says nothing about a draft it is seeing for the first time", () => {
    const after = snapshot({
      drafts: [
        { sleeperDraftId: "d1", status: "complete", season: 2026 },
        { sleeperDraftId: "d2", status: "pre_draft", season: 2027 },
      ],
    });
    expect(
      diffLeagueSnapshots(snapshot(), after, opts).filter(
        (e) => e.kind === "draft_status_change",
      ),
    ).toHaveLength(0);
  });
});

describe("an empty array is not evidence", () => {
  // The two highest-severity bugs review found, and the reason CLAUDE.md
  // carries an absolute rule about this for Power Pulse. `getSleeperLeagueUsers`
  // returns [] on a FAILED request, and a snapshot whose child read errored
  // looks the same from here. Either one, diffed naively, writes a permanent
  // card for every manager in the league.

  it("does not report every manager leaving when Sleeper answered with nothing", () => {
    const after = snapshot({ users: [] });
    expect(
      diffLeagueSnapshots(snapshot(), after, opts).filter((e) => e.kind === "manager_left"),
    ).toEqual([]);
  });

  it("does not report every manager joining when the prior read came back empty", () => {
    const before = snapshot({ users: [] });
    expect(
      diffLeagueSnapshots(before, snapshot(), opts).filter((e) => e.kind === "manager_joined"),
    ).toHaveLength(2);
    // The joining direction is legitimate: an empty PRIOR is a league we had no
    // members for, and members appearing is real. The failure mode guarded
    // above is the other direction. `record.ts` fails closed on a read error so
    // this case cannot arise from a broken query.
  });

  it("does not report every roster changing hands when the roster fetch failed", () => {
    const after = snapshot({ rosters: [] });
    const kinds = diffLeagueSnapshots(snapshot(), after, opts).map((e) => e.kind);
    expect(kinds).not.toContain("roster_owner_change");
    expect(kinds).not.toContain("lineup_change");
    expect(kinds).not.toContain("reserve_move");
  });

  it("does not report every scoring rule being deleted when settings came back empty", () => {
    const after = snapshot({ scoringSettings: {}, settings: {}, rosterPositions: [] });
    const kinds = diffLeagueSnapshots(snapshot(), after, opts).map((e) => e.kind);
    expect(kinds).not.toContain("scoring_change");
    expect(kinds).not.toContain("league_setting_change");
    expect(kinds).not.toContain("roster_positions_change");
  });

  it("still reports a league that genuinely had no members and still has none", () => {
    const before = snapshot({ users: [], rosters: [] });
    const after = snapshot({ users: [], rosters: [], name: "Renamed" });
    expect(
      diffLeagueSnapshots(before, after, opts).map((e) => e.kind),
    ).toEqual(["league_renamed"]);
  });
});

describe("rosters coming and going", () => {
  it("says nothing about a roster it has never seen before", () => {
    const after = snapshot();
    after.rosters = [
      ...after.rosters,
      {
        sleeperRosterId: 3,
        ownerUserId: "u3",
        playerIds: ["900"],
        starterIds: ["900"],
        reserveIds: [],
        taxiIds: [],
      },
    ];
    const kinds = diffLeagueSnapshots(snapshot(), after, opts).map((e) => e.kind);
    expect(kinds).not.toContain("lineup_change");
    expect(kinds).not.toContain("roster_owner_change");
  });

  it("says nothing about a roster that disappeared", () => {
    const after = snapshot();
    after.rosters = [after.rosters[0]];
    const kinds = diffLeagueSnapshots(snapshot(), after, opts).map((e) => e.kind);
    expect(kinds).not.toContain("lineup_change");
  });
});

describe("clock skew", () => {
  it("treats a window that runs backwards as unusable rather than very fresh", () => {
    // A negative window means the two clocks disagree, and reading it as "zero
    // milliseconds ago" would let a stale comparison through the ceiling.
    const before = snapshot();
    const after = snapshot();
    after.rosters[0] = { ...after.rosters[0], starterIds: ["100", "300"] };
    const events = diffLeagueSnapshots(before, after, {
      ...opts,
      observedFrom: "2026-09-16T16:00:00.000Z",
    });
    expect(events.filter((e) => e.kind === "lineup_change")).toEqual([]);
  });
});

describe("dedupe keys", () => {
  it("are identical for two detectors reading the same prior state", () => {
    // The guarantee that stops two server instances posting the same lineup
    // swap twice. Both read the same stored row, so both compute the same
    // `observedFrom`, so both compute the same key.
    const before = snapshot();
    const after = snapshot({ name: "Renamed" });
    const a = diffLeagueSnapshots(before, after, { ...opts, now: "2026-09-16T15:00:00.000Z" });
    const b = diffLeagueSnapshots(before, after, { ...opts, now: "2026-09-16T15:00:04.000Z" });
    expect(a[0].dedupeKey).toBe(b[0].dedupeKey);
  });

  it("differ once the observation window moves on", () => {
    const before = snapshot();
    const after = snapshot({ name: "Renamed" });
    const a = diffLeagueSnapshots(before, after, opts);
    const b = diffLeagueSnapshots(before, after, {
      ...opts,
      observedFrom: "2026-09-16T14:30:00.000Z",
    });
    expect(a[0].dedupeKey).not.toBe(b[0].dedupeKey);
  });

  it("differ for two different changes in the same window", () => {
    const before = snapshot();
    const a = diffLeagueSnapshots(before, snapshot({ name: "One" }), opts);
    const b = diffLeagueSnapshots(before, snapshot({ name: "Two" }), opts);
    expect(a[0].dedupeKey).not.toBe(b[0].dedupeKey);
  });
});

describe("fingerprint", () => {
  it("does not depend on key order", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it("separates different contents", () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("diffNumericMaps", () => {
  it("returns changes sorted by key, so the fingerprint is stable", () => {
    const changes = diffNumericMaps({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(changes.map((c) => c.key)).toEqual(["a", "z"]);
  });

  it("compares numeric strings as numbers", () => {
    expect(diffNumericMaps({ a: "4" }, { a: 4 })).toEqual([]);
  });
});
