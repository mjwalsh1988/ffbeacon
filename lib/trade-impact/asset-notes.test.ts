import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  readAsset,
  positionalWarSentence,
  type PositionalWarContext,
} from "./asset-notes";
import { buildTradeOutcome } from "./outcome";
import type { ImpactGaps, ResolvedAsset, TeamImpact } from "./types";
import { TradeOutcomePanel } from "@/components/trade-ideas/trade-outcome";

/**
 * Positional WAR as labelled context on the asset card (extension E3).
 *
 * Three things are pinned here, matching the three constraints in
 * docs/league-pulse/league-pulse-positional-war-plan.md section 15.3: the template renders
 * every figure exactly (constraint 2), a missing or non-matching map is a
 * no-op that leaves the rest of the verdict untouched (constraint 1, this file
 * never reads the cache itself), and the rendered block sits outside the
 * container holding the roster-specific wins figure (constraint 3).
 */

const NO_GAPS: ImpactGaps = { lineup: false, simulation: false, picks: false };

function playerAsset(overrides: Partial<Extract<ResolvedAsset, { kind: "player" }>> = {}): ResolvedAsset {
  return {
    kind: "player",
    playerId: "p1",
    sleeperId: "101",
    name: "Somebody",
    position: "WR",
    team: "BUF",
    value: 6000,
    age: 25,
    projPoints: 12,
    isInactive: false,
    ...overrides,
  };
}

function pickAsset(overrides: Partial<Extract<ResolvedAsset, { kind: "pick" }>> = {}): ResolvedAsset {
  return {
    kind: "pick",
    key: "2027-1-1",
    label: "2027 R1 Early",
    season: 2027,
    round: 1,
    pickPosition: "early",
    originalRosterId: 1,
    isOwnPick: true,
    originalOwnerHandle: null,
    originalTeamName: null,
    positionEstimated: false,
    value: 3000,
    ...overrides,
  };
}

const BASE_OPTS = {
  direction: "incoming" as const,
  sideTotal: 6000,
  sideCount: 1,
  isLargest: true,
  positionDelta: null,
  weeksConsidered: 10,
  startWeeksByPlayer: {},
  noLineup: false,
  isDynasty: true,
};

const WAR_CONTEXT: PositionalWarContext = {
  war: 1.234,
  positionRank: 3,
  structuralDemand: 24,
  position: "RB",
};

describe("positionalWarSentence", () => {
  it("renders every figure exactly, per the deterministic template", () => {
    expect(positionalWarSentence(WAR_CONTEXT)).toBe(
      "1.23 wins over replacement. RB3 of the 24 this league starts.",
    );
  });

  it("rounds war to two decimals without touching the other three figures", () => {
    expect(
      positionalWarSentence({ war: 0, positionRank: 1, structuralDemand: 12, position: "QB" }),
    ).toBe("0.00 wins over replacement. QB1 of the 12 this league starts.");
  });
});

describe("readAsset: positionalWar is read-only context", () => {
  it("is null and every other field is unchanged when no map is passed (E3-1)", () => {
    const withMap = readAsset(playerAsset(), {
      ...BASE_OPTS,
      positionalWarByPlayer: new Map([["999", WAR_CONTEXT]]),
    });
    const withoutMap = readAsset(playerAsset(), BASE_OPTS);

    expect(withoutMap.positionalWar).toBeNull();
    // Same player, same map key absent either way: everything but the new
    // field is identical to what readAsset returned before this field existed.
    expect(withoutMap).toEqual({ ...withMap, positionalWar: null });
  });

  it("is null for a draft pick, which the model excludes entirely (E3-5)", () => {
    const map = new Map([["101", WAR_CONTEXT]]);
    const verdict = readAsset(pickAsset(), { ...BASE_OPTS, positionalWarByPlayer: map });
    expect(verdict.positionalWar).toBeNull();
  });

  it("is null for a player past the display depth cap (absent from the map)", () => {
    // The map is real and non-empty, it just does not carry this player: the
    // curve was capped before his rank.
    const map = new Map([["other-player", WAR_CONTEXT]]);
    const verdict = readAsset(playerAsset({ sleeperId: "101" }), {
      ...BASE_OPTS,
      positionalWarByPlayer: map,
    });
    expect(verdict.positionalWar).toBeNull();
  });

  it("is null for a player with no Sleeper id", () => {
    const map = new Map([["101", WAR_CONTEXT]]);
    const verdict = readAsset(playerAsset({ sleeperId: null }), {
      ...BASE_OPTS,
      positionalWarByPlayer: map,
    });
    expect(verdict.positionalWar).toBeNull();
  });

  it("resolves the player's own entry when the map carries him", () => {
    const map = new Map([["101", WAR_CONTEXT]]);
    const verdict = readAsset(playerAsset({ sleeperId: "101" }), {
      ...BASE_OPTS,
      positionalWarByPlayer: map,
    });
    expect(verdict.positionalWar).toEqual(WAR_CONTEXT);
  });
});

/* ------------------------------------------------------------------ */
/* Structural separation on the rendered card (E3-2, E3-3)             */
/* ------------------------------------------------------------------ */

function team(overrides: Partial<TeamImpact> = {}): TeamImpact {
  return {
    rosterId: 1,
    teamName: "My Team",
    statusKey: null,
    statusLabel: null,
    pulseRank: null,
    valueBefore: 20000,
    valueAfter: 20000,
    valueDelta: 0,
    ageDelta: null,
    pickCountDelta: 0,
    lineupBefore: 100,
    lineupAfter: 100,
    lineupDelta: 0,
    weeks: [],
    weeksImproved: 0,
    weeksWorsened: 0,
    incomingStartWeeks: {},
    projectedWinsBefore: 6,
    projectedWinsAfter: 7,
    playoffOddsBefore: 0.5,
    playoffOddsAfter: 0.55,
    titleOddsBefore: 0.1,
    titleOddsAfter: 0.12,
    positionBefore: {},
    positionAfter: {},
    incoming: [],
    outgoing: [],
    ...overrides,
  };
}

/**
 * The index range, in an HTML string, of the element whose opening tag starts
 * at `openTagIndex`. Balances nested tags of the SAME name so a div containing
 * other divs still resolves to its own true close tag rather than the first
 * `</div>` the parser meets.
 */
function elementRange(html: string, openTagIndex: number): [number, number] {
  const tagMatch = /^<([a-zA-Z0-9]+)/.exec(html.slice(openTagIndex));
  if (!tagMatch) throw new Error("no tag at index");
  const tag = tagMatch[1];
  const openToken = `<${tag}`;
  const closeToken = `</${tag}>`;
  let depth = 0;
  let i = openTagIndex;
  while (i < html.length) {
    const nextOpen = html.indexOf(openToken, i);
    const nextClose = html.indexOf(closeToken, i);
    if (nextClose === -1) throw new Error("unbalanced markup");
    const opensNext =
      nextOpen !== -1 &&
      nextOpen < nextClose &&
      /[\s>]/.test(html[nextOpen + openToken.length] ?? "");
    if (opensNext) {
      depth += 1;
      i = nextOpen + openToken.length;
    } else {
      depth -= 1;
      i = nextClose + closeToken.length;
      if (depth === 0) return [openTagIndex, i];
    }
  }
  throw new Error("no matching close tag found");
}

/** [start, end) of the element carrying `data-role="${role}"`. */
function rangeForRole(html: string, role: string): [number, number] {
  const markerIndex = html.indexOf(`data-role="${role}"`);
  expect(markerIndex, `data-role="${role}" not found in rendered output`).toBeGreaterThan(-1);
  const openTagIndex = html.lastIndexOf("<", markerIndex);
  return elementRange(html, openTagIndex);
}

function within(inner: [number, number], outer: [number, number]): boolean {
  return outer[0] <= inner[0] && inner[1] <= outer[1];
}

describe("TradeOutcomePanel: the Positional WAR block sits outside the wins container", () => {
  it("renders the block, labelled, next to a working Signal Guide link", () => {
    const mine = team({
      incoming: [playerAsset({ sleeperId: "101", position: "RB" })],
      outgoing: [pickAsset()],
    });
    const outcome = buildTradeOutcome(mine, NO_GAPS);
    const html = renderToStaticMarkup(
      TradeOutcomePanel({
        outcome,
        mine,
        gaps: NO_GAPS,
        weeksConsidered: 10,
        isDynasty: true,
        myTeamLabel: "My Team",
        theirTeamLabel: "Their Team",
        sleeperLeagueId: "999999",
        positionalWarByPlayer: new Map([["101", WAR_CONTEXT]]),
      }),
    );

    expect(html).toContain("Positional WAR (league-wide)");
    expect(html).toContain(positionalWarSentence(WAR_CONTEXT));
    // A real, working link (constraint 2), not a colour or an icon standing in
    // for one (the accessibility rule).
    expect(html).toMatch(/<a[^>]+href="\/leagues\/999999"[^>]*>What is Positional WAR\?<\/a>/);
  });

  it("E3-2: the block is structurally outside the container holding the wins figure", () => {
    const mine = team({
      incoming: [playerAsset({ sleeperId: "101", position: "RB" })],
      outgoing: [pickAsset()],
    });
    const outcome = buildTradeOutcome(mine, NO_GAPS);
    const html = renderToStaticMarkup(
      TradeOutcomePanel({
        outcome,
        mine,
        gaps: NO_GAPS,
        weeksConsidered: 10,
        isDynasty: true,
        myTeamLabel: "My Team",
        theirTeamLabel: "Their Team",
        sleeperLeagueId: "999999",
        positionalWarByPlayer: new Map([["101", WAR_CONTEXT]]),
      }),
    );

    const winsRange = rangeForRole(html, "wins-metric");
    const warRange = rangeForRole(html, "positional-war-block");

    expect(within(warRange, winsRange)).toBe(false);
    expect(within(winsRange, warRange)).toBe(false);
  });

  it("E3-3: every occurrence of Positional WAR in the rendered output is fully qualified", () => {
    const mine = team({
      incoming: [playerAsset({ sleeperId: "101", position: "RB" })],
      outgoing: [pickAsset()],
    });
    const outcome = buildTradeOutcome(mine, NO_GAPS);
    const html = renderToStaticMarkup(
      TradeOutcomePanel({
        outcome,
        mine,
        gaps: NO_GAPS,
        weeksConsidered: 10,
        isDynasty: true,
        myTeamLabel: "My Team",
        theirTeamLabel: "Their Team",
        sleeperLeagueId: "999999",
        positionalWarByPlayer: new Map([["101", WAR_CONTEXT]]),
      }),
    );

    const bareWar = html.match(/\bWAR\b/g) ?? [];
    const qualifiedWar = html.match(/Positional WAR/g) ?? [];
    expect(bareWar.length).toBeGreaterThan(0);
    expect(bareWar.length).toBe(qualifiedWar.length);
  });

  it("E3-4: nothing here writes to the cache or refreshes it (read-only, checked by import shape)", async () => {
    // The module under test imports only the read-only loader's exported type,
    // never lib/league-positional-war.ts (the writer). A static check rather
    // than a spy: this file has no reference to refreshPositionalWar at all.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../components/trade-ideas/trade-outcome.tsx", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/refreshPositionalWar/);
    expect(source).not.toMatch(/league-positional-war/);
  });

  it("renders nothing extra when the league has no cached curve", () => {
    const mine = team({
      incoming: [playerAsset({ sleeperId: "101", position: "RB" })],
      outgoing: [pickAsset()],
    });
    const outcome = buildTradeOutcome(mine, NO_GAPS);
    const html = renderToStaticMarkup(
      TradeOutcomePanel({
        outcome,
        mine,
        gaps: NO_GAPS,
        weeksConsidered: 10,
        isDynasty: true,
        myTeamLabel: "My Team",
        theirTeamLabel: "Their Team",
        sleeperLeagueId: "999999",
        // No positionalWarByPlayer at all: an empty league.
      }),
    );

    expect(html).not.toContain("Positional WAR (league-wide)");
    expect(html).not.toContain("data-role=\"positional-war-block\"");
  });
});
