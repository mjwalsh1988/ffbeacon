import { describe, expect, it } from "vitest";
import {
  buildShareCard,
  describeShareCard,
  displayName,
} from "./share-card";
import type {
  MatchupSide,
  MatchupSlotEntry,
  MatchupView,
  SchedulePlayer,
  ScheduleSlot,
  SlotGroup,
} from "./types";

/**
 * The share card is the one surface in League Pulse that travels WITHOUT the
 * page around it. Nothing on a screenshot can be checked, corrected or asked a
 * follow-up question, so the rules these tests hold are about what the picture
 * is allowed to CLAIM: never a projection dressed as a score, never a zero
 * standing in for a number nobody published, never a win chance over a game
 * that has already half happened.
 */

function slot(
  token: string,
  order: number,
  group: SlotGroup = "QB",
  projectable = true,
): ScheduleSlot {
  return {
    token,
    label: token,
    description: `the ${token} slot`,
    group,
    projectable,
    order,
  };
}

function player(
  name: string,
  overrides: Partial<SchedulePlayer> = {},
): SchedulePlayer {
  return {
    playerId: `p-${name}`,
    sleeperId: `s-${name}`,
    name,
    position: "QB",
    team: "BUF",
    injuryStatus: null,
    nflOpponent: "MIA",
    nflIsHome: null,
    opponentMultiplier: null,
    beatRate: null,
    availability: null,
    reliability: null,
    projected: 20,
    sigma: 6,
    actual: null,
    isInactive: false,
    ...overrides,
  };
}

function side(
  name: string,
  slots: MatchupSlotEntry[],
  overrides: Partial<MatchupSide> = {},
): MatchupSide {
  return {
    sleeperRosterId: 1,
    rosterRowId: "r-1",
    teamName: name,
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: 3, losses: 1, ties: 0 },
    pulseRank: 2,
    slots,
    projectedTotal: 100,
    sigma: 12,
    actualTotal: null,
    scoredTotal: null,
    optimalTotal: null,
    pointsLeftOnBench: null,
    benchUpgrades: [],
    unprojectedSlots: 0,
    ...overrides,
  };
}

function view(overrides: Partial<MatchupView> = {}): MatchupView {
  const slots = [slot("QB", 0), slot("RB", 1, "RB")];
  const home = side(
    "Home Team",
    [
      { slot: slots[0], player: player("Josh Allen") },
      { slot: slots[1], player: player("Bijan Robinson", { position: "RB" }) },
    ],
    { projectedTotal: 110 },
  );
  const away = side(
    "Away Team",
    [
      { slot: slots[0], player: player("Jayden Daniels") },
      { slot: slots[1], player: player("Saquon Barkley", { position: "RB" }) },
    ],
    { sleeperRosterId: 2, rosterRowId: "r-2", projectedTotal: 96 },
  );

  return {
    week: 4,
    season: 2026,
    isFinal: false,
    isCurrent: true,
    home,
    away,
    homeWinProb: 0.62,
    hasUnprojectableSlots: false,
    resultsVisible: false,
    ...overrides,
  };
}

describe("buildShareCard before the games start", () => {
  it("leads with projections and offers a win chance", () => {
    const card = buildShareCard(view(), "Test League");

    expect(card.basisLabel).toBe("Projected");
    expect(card.home.total).toBe(110);
    expect(card.away?.total).toBe(96);
    // Printing the projection twice, once as the headline and once beneath it,
    // says nothing.
    expect(card.home.projected).toBeNull();
    expect(card.home.winPct).toBe(62);
    expect(card.away?.winPct).toBe(38);
  });

  it("says which week it is without repeating the week number", () => {
    // The line this label sits on already reads "week 4". An earlier version
    // put the number in both halves and rendered "week 4, week 4".
    expect(buildShareCard(view(), "L").stateLabel).toBe("This week");
    // And the word is the SAME word the page prints above its own heading, so a
    // reader is never told two different things about one week.
    expect(buildShareCard(view({ isCurrent: false }), "L").stateLabel).toBe(
      "Upcoming",
    );
  });
});

describe("buildShareCard once the games have started", () => {
  const started = () => {
    const base = view({ resultsVisible: true });
    base.home.scoredTotal = 118.4;
    base.away!.scoredTotal = 91.2;
    base.home.slots[0].player!.actual = 24.6;
    base.away!.slots[0].player!.actual = 12.1;
    return base;
  };

  it("leads with the score and keeps the projection beside it", () => {
    const card = buildShareCard(started(), "Test League");

    expect(card.basisLabel).toBe("Scored");
    expect(card.home.total).toBe(118.4);
    // The projection is not dropped: "24.6, projected 20.0" is the story of a
    // Sunday and half of it is not.
    expect(card.home.projected).toBe(110);
    expect(card.rows[0].home?.points).toBe(24.6);
    expect(card.rows[0].home?.projected).toBe(20);
  });

  it("takes the win chance off the card entirely", () => {
    // It is built from WHOLE WEEK projections. Leaving it up would put a
    // forecast directly above a score that has already half happened, and a
    // still image gives a reader no way to notice the contradiction.
    const card = buildShareCard(started(), "Test League");
    expect(card.home.winPct).toBeNull();
    expect(card.away?.winPct).toBeNull();
    expect(card.margin).toEqual({ teamName: "Home Team", points: 118.4 - 91.2 });
  });

  it("calls a settled week final and a live one in progress", () => {
    expect(buildShareCard(started(), "L").stateLabel).toBe("In progress");
    const final = started();
    final.isFinal = true;
    expect(buildShareCard(final, "L").stateLabel).toBe("Final");
  });
});

describe("what the card refuses to claim", () => {
  it("never marks both sides of a row as leading, and never marks a tie", () => {
    const tied = view();
    tied.home.slots[0].player!.projected = 18;
    tied.away!.slots[0].player!.projected = 18;

    const card = buildShareCard(tied, "L");
    expect(card.rows[0].home?.leading).toBe(false);
    expect(card.rows[0].away?.leading).toBe(false);
  });

  it("leaves a slot with no published number as null rather than zero", () => {
    const missing = view();
    missing.home.slots[0].player!.projected = null;

    const card = buildShareCard(missing, "L");
    expect(card.rows[0].home?.points).toBeNull();
    // And a null is not a loss: the other side is not crowned by default.
    expect(card.rows[0].away?.leading).toBe(false);
  });

  it("reports no margin when either total is missing", () => {
    const partial = view({ resultsVisible: true });
    partial.home.scoredTotal = 100;
    partial.away!.scoredTotal = null;
    expect(buildShareCard(partial, "L").margin).toBeNull();
  });

  it("says how many slots the totals leave out", () => {
    const idp = view({ hasUnprojectableSlots: true });
    idp.home.slots.push({
      slot: slot("IDP_FLEX", 2, "IDP", false),
      player: null,
    });

    const card = buildShareCard(idp, "L");
    expect(card.footnote).toContain("1 IDP slot");
  });
});

describe("pairing the two lineups", () => {
  it("pairs on the league's own slot order, not on display order", () => {
    // The rows are regrouped for display (every RB under every QB), so the away
    // side has to be looked up by the ALIGNMENT index. Pairing on the position
    // in the reordered list is what would put a running back opposite a
    // quarterback in a league whose roster_positions interleave them.
    const slots = [slot("RB", 0, "RB"), slot("QB", 1)];
    const v = view();
    v.home = side("Home Team", [
      { slot: slots[0], player: player("Bijan Robinson", { position: "RB" }) },
      { slot: slots[1], player: player("Josh Allen") },
    ]);
    v.away = side("Away Team", [
      { slot: slots[0], player: player("Saquon Barkley", { position: "RB" }) },
      { slot: slots[1], player: player("Jayden Daniels") },
    ]);

    const card = buildShareCard(v, "L");
    // QB block renders first, so row one is the quarterbacks on both sides.
    expect(card.rows[0].home?.name).toBe("Josh Allen");
    expect(card.rows[0].away?.name).toBe("Jayden Daniels");
    expect(card.rows[1].home?.name).toBe("Bijan Robinson");
    expect(card.rows[1].away?.name).toBe("Saquon Barkley");
  });

  it("renders an unpaired roster on its own", () => {
    const card = buildShareCard(view({ away: null, homeWinProb: null }), "L");
    expect(card.away).toBeNull();
    expect(card.margin).toBeNull();
    expect(card.rows.every((row) => row.away === null)).toBe(true);
  });
});

describe("displayName", () => {
  // The ladder is exercised with an explicit width so each rung is pinned on
  // its own, rather than on whatever the column happens to be this month. The
  // default is asserted separately, once.
  it("leaves a name that fits exactly as it is", () => {
    expect(displayName("Josh Allen", 20)).toBe("Josh Allen");
    expect(displayName("Christian McCaffrey")).toBe("Christian McCaffrey");
  });

  it("falls to the initial form before it truncates anything", () => {
    expect(displayName("Christian McCaffrey", 14)).toBe("C. McCaffrey");
  });

  it("gives a team defence the name people actually use", () => {
    // "N. England Pat..." is a string naming nobody. The row already says
    // DEF, NE underneath, so the last word carries it on its own.
    expect(displayName("New England Patriots", 14)).toBe("Patriots");
  });

  it("truncates only a single token with nothing else to fall back on", () => {
    expect(displayName("Supercalifragilisticexpialidocious")).toContain("...");
  });

  it("keeps the default wide enough for the names people actually have", () => {
    for (const name of ["Amon-Ra St. Brown", "Christian McCaffrey", "Marvin Harrison Jr"]) {
      expect(displayName(name)).toBe(name);
    }
  });
});

describe("describeShareCard", () => {
  it("puts the score itself in the sentence, not a description of the picture", () => {
    const started = view({ resultsVisible: true, isFinal: true });
    started.home.scoredTotal = 118.4;
    started.away!.scoredTotal = 91.2;

    const said = describeShareCard(buildShareCard(started, "Test League"));
    expect(said).toContain("Home Team 118.4");
    expect(said).toContain("Away Team 91.2");
    expect(said).toContain("Home Team ahead by 27.2");
  });

  it("says so when there is no opponent, and still names the state", () => {
    const said = describeShareCard(
      buildShareCard(view({ away: null, homeWinProb: null }), "Test League"),
    );
    expect(said).toContain("no opponent");
    expect(said).toContain("this week");
  });

  it("turns a missing total into a clause rather than a word in a number slot", () => {
    const partial = view({ resultsVisible: true });
    partial.home.scoredTotal = null;
    partial.away!.scoredTotal = 91.2;

    const said = describeShareCard(buildShareCard(partial, "Test League"));
    expect(said).toContain("no total available for Home Team");
    expect(said).toContain("Away Team 91.2");
  });
});
