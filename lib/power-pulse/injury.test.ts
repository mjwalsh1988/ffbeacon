import { describe, it, expect } from "vitest";
import { injuryMultiplier, projectPlayerWeek, LONG_TERM_INJURY_STATUSES } from "./project";
import { DEFAULT_POWER_PULSE_SETTINGS } from "./default-settings";
import type { ProjectionRow } from "./load";

const S = DEFAULT_POWER_PULSE_SETTINGS;
const CURRENT_WEEK = 5;

describe("injuryMultiplier: season-long designations", () => {
  it("zeroes every remaining week the source has no opinion about", () => {
    // An IR stash with no per-week signal is out in week 5 and still out in
    // week 17. A Questionable tag would only touch week 5.
    expect(injuryMultiplier("IR", CURRENT_WEEK, CURRENT_WEEK, S)).toBe(0);
    expect(injuryMultiplier("IR", 17, CURRENT_WEEK, S)).toBe(0);
  });

  it("stands down for a week the source has already answered", () => {
    // The correction that produced pp-3. A season-long tag carries no timeline;
    // Sleeper's per-week availability does, and it is the better answer.
    // Jordyn Tyson is on IR and Sleeper projects him 10.7 a week from week 5.
    expect(injuryMultiplier("IR", 17, CURRENT_WEEK, S, { sourcePricedIn: true })).toBe(1);
    expect(injuryMultiplier("PUP", 12, CURRENT_WEEK, S, { sourcePricedIn: true })).toBe(1);
    // Josh Jacobs, DNR, projected about 14 a week from week 2. Zeroing him
    // moved his team from seventh in its league to last.
    expect(injuryMultiplier("DNR", 8, CURRENT_WEEK, S, { sourcePricedIn: true })).toBe(1);
  });

  it("covers every designation the set claims to cover", () => {
    for (const status of LONG_TERM_INJURY_STATUSES) {
      expect(
        injuryMultiplier(status, 18, CURRENT_WEEK, S),
        `${status} did not zero an unanswered future week`,
      ).toBe(0);
    }
  });

  it("is case insensitive, because Sleeper writes Sus and PUP however it likes", () => {
    expect(injuryMultiplier("ir", 9, CURRENT_WEEK, S)).toBe(0);
    expect(injuryMultiplier("pup", 9, CURRENT_WEEK, S)).toBe(0);
  });
});

describe("injuryMultiplier: week-to-week designations", () => {
  it("discounts only the current week when nothing else priced it in", () => {
    expect(injuryMultiplier("Questionable", CURRENT_WEEK, CURRENT_WEEK, S)).toBe(0.9);
    expect(injuryMultiplier("Questionable", CURRENT_WEEK + 1, CURRENT_WEEK, S)).toBe(1);
  });

  it("stands down when the source already priced the injury in", () => {
    // Sleeper lists Tank Dell Questionable and projects him 6.42, not his
    // healthy figure. Applying another 0.9 discounts one injury twice and makes
    // every banged-up starter look worse than the market thinks he is.
    expect(
      injuryMultiplier("Questionable", CURRENT_WEEK, CURRENT_WEEK, S, { sourcePricedIn: true }),
    ).toBe(1);
    expect(
      injuryMultiplier("Doubtful", CURRENT_WEEK, CURRENT_WEEK, S, { sourcePricedIn: true }),
    ).toBe(1);
  });

  it("leaves a healthy player alone either way", () => {
    expect(injuryMultiplier(null, CURRENT_WEEK, CURRENT_WEEK, S)).toBe(1);
    expect(injuryMultiplier(null, CURRENT_WEEK, CURRENT_WEEK, S, { sourcePricedIn: true })).toBe(1);
  });

  it("ignores a designation the settings have no opinion about", () => {
    expect(injuryMultiplier("Probable-ish", CURRENT_WEEK, CURRENT_WEEK, S)).toBe(1);
  });

  it("still fires when the settings switch injuries off entirely", () => {
    const off = { ...S, injury: { ...S.injury, enabled: false } };
    expect(injuryMultiplier("IR", 12, CURRENT_WEEK, off)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */

function projection(partial: Partial<ProjectionRow>): ProjectionRow {
  return {
    playerId: "p1",
    week: 10,
    opponent: "DAL",
    statLine: null,
    ppr: 12,
    halfPpr: 10,
    std: 8,
    availability: "projected",
    injuryStatus: null,
    ...partial,
  };
}

function project(row: ProjectionRow | undefined, injuryStatus: string | null) {
  return projectPlayerWeek({
    projection: row,
    subject: { position: "WR", injuryStatus },
    accuracy: null,
    reliability: 1,
    scoringSettings: null,
    defense: new Map(),
    defenseSeasons: [],
    week: 10,
    currentWeek: CURRENT_WEEK,
    settings: S,
  });
}

describe("projectPlayerWeek", () => {
  it("returns a hard zero for an out row, with no multipliers applied", () => {
    const result = project(projection({ availability: "out", ppr: 0, halfPpr: 0, std: 0 }), "IR");
    expect(result).not.toBeNull();
    expect(result?.points).toBe(0);
    expect(result?.sigma).toBe(0);
    expect(result?.opponentMultiplier).toBe(1);
  });

  it("returns null for an absent week, which is not a zero", () => {
    // A bye. Callers must treat this as no opinion; a zero would drag the
    // player's average down every time his team rests.
    expect(project(undefined, null)).toBeNull();
  });

  it("returns null when an unprojected row carries no number at all", () => {
    const unprojected = projection({
      availability: "unprojected",
      ppr: null,
      halfPpr: null,
      std: null,
      statLine: null,
    });
    expect(project(unprojected, null)).toBeNull();
  });

  it("does not double-discount a Questionable player Sleeper already priced", () => {
    const healthy = project(projection({}), null);
    const questionable = project(projection({}), "Questionable");
    expect(questionable?.points).toBe(healthy?.points);
  });

  it("honours a return timeline instead of overruling it", () => {
    // Jordyn Tyson, end to end. Sleeper marks him out through week 4 and
    // projects 10.7 from week 5, and both halves of that must survive: the out
    // weeks score zero, and the projected weeks score the projection.
    const out = project(
      projection({ availability: "out", ppr: 0, halfPpr: 0, std: 0 }),
      "IR",
    );
    expect(out?.points).toBe(0);

    const back = project(
      projection({ availability: "projected", ppr: 10.7, halfPpr: 10.7, std: 10.7 }),
      "IR",
    );
    expect(back?.points).toBeCloseTo(10.7, 5);
  });

  it("still zeroes a designated player the source says nothing about", () => {
    // The stale-projection guard, in the shape that still needs it: no per-week
    // opinion, so the designation is the only signal there is. A source that
    // publishes a number without saying whether the player suits up lands here.
    const noOpinion = project(
      projection({ availability: "unprojected", ppr: 8.9, halfPpr: 8.9, std: 8.9 }),
      "IR",
    );
    expect(noOpinion?.points).toBe(0);
  });
});
