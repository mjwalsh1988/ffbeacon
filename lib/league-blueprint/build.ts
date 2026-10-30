/**
 * The Team Blueprint assembler. Pure: plain data in, one BlueprintView out.
 *
 * data.ts gathers every input (the league's team cards, the trade finder
 * league, Power Pulse, the Manager Ledger slice, market signals, 30-day
 * trends, the aligned lineup, reserve and taxi ids, the settled week) and
 * runs the one async step, the trade strategy board, before calling this.
 * Everything here is arithmetic over those inputs through the section modules
 * beside this file; nothing reads a database, a clock or a viewer.
 *
 * Lineup and depth (plan 6.14) have no module of their own and are assembled
 * here: one entry per aligned starting slot (Sleeper's POSITIONAL starters,
 * "0" meaning empty), then the roster by position, then IR and taxi, then the
 * defenders and specialists who carry no market value.
 */

import { isDefender } from "@/lib/site";
import type { FormatTag } from "@/lib/league-format-tags";
import type { TeamStatus } from "@/lib/league-team-status";
import type { ResolvedPlayer, TeamCardData } from "@/lib/league-view-data";
import { buildTeamProfile, leagueStarterBaselines, type TeamProfile } from "@/lib/trade-finder/profile";
import type { FinderTeam } from "@/lib/trade-finder/types";
import { computeActivity } from "./activity";
import { computeAge, type AgePlayer } from "./age";
import { NO_PULSE_STANDING, REDRAFT_OUTLOOK, rosterArchetype, twoYearOutlook, valueArchetype } from "./archetype";
import { computeBuyTargets, computeCalls, type CallPlayer } from "./calls";
import { computeCapital } from "./capital";
import { BLUEPRINT_POSITIONS, type BlueprintPosition, type LeagueBlueprintSettings } from "./default-settings";
import { computeGrades } from "./grades";
import { computeMovers, type RosterTrend } from "./movers";
import { computePartners } from "./partners";
import { computePriorities } from "./priorities";
import { computeShares } from "./shares";
import { computeSpotlight, type SpotlightInput } from "./spotlight";
import type { StrategyBuild } from "./strategy";
import {
  BLUEPRINT_MODEL_VERSION,
  type BlueprintPlayer,
  type BlueprintView,
  type LineupSlot,
  type MarketSignalState,
} from "./types";

export type PulseSlice = {
  rosterId: number;
  status: TeamStatus | null;
  positionRanks: Record<string, number | null>;
  scoreDepthRank: number | null;
  rankDivergence: number | null;
  pulseRank: number | null;
};

export type LedgerSlice = {
  efficiency: number;
  gradedWeeks: number;
  pointsLeftPerWeek: number;
  efficiencyRank: number | null;
};

export type AlignedSlot = { token: string; label: string; description: string };

export type BlueprintInputs = {
  sleeperLeagueId: string;
  season: string;
  rosterId: number;
  generatedAt: string;
  isDynasty: boolean;
  isSuperflex: boolean;
  formatTags: FormatTag[];
  formatDisplay: string;
  sourceSlug: string;
  sourceDisplay: string;
  pickSourceDisplay: string | null;
  cards: TeamCardData[];
  finderTeams: FinderTeam[];
  startingSlots: string[];
  pulse: PulseSlice[] | null;
  ledger: LedgerSlice | null;
  /** players.id to market signal for the reader's roster and every target. */
  signals: ReadonlyMap<string, MarketSignalState>;
  /** players.id to trend row, the reader's roster. */
  trends: ReadonlyMap<string, Omit<RosterTrend, "playerId" | "name" | "position" | "team" | "sleeperId">>;
  formatTopValue: number;
  alignedSlots: AlignedSlot[];
  /** Sleeper's positional starters array, "0" or "" for an empty slot. */
  rawStarterSleeperIds: string[];
  reserveSleeperIds: string[];
  taxiSleeperIds: string[];
  /** The latest settled week's top scorer on this roster, by Sleeper id. */
  spotlightWeek: { sleeperId: string; week: number; points: number; average: number | null } | null;
  strategy: StrategyBuild;
  settings: LeagueBlueprintSettings;
};

/** Profiles for every finder team, against the league's own starter baselines. */
export function profilesFor(
  teams: FinderTeam[],
  slots: string[],
  isDynasty: boolean,
): Map<number, TeamProfile> {
  const baselines = leagueStarterBaselines(teams, slots);
  return new Map(teams.map((t) => [t.rosterId, buildTeamProfile(t, slots, baselines, { isDynasty })]));
}

const isPricedPosition = (p: string): p is BlueprintPosition =>
  (BLUEPRINT_POSITIONS as readonly string[]).includes(p);

const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildBlueprintView(input: BlueprintInputs): BlueprintView {
  const mine = input.cards.find((c) => c.sleeperRosterId === input.rosterId);
  if (!mine) throw new Error(`Roster ${input.rosterId} is not in the league cards.`);
  const T = mine.teamCount || input.cards.length;
  const finderById = new Map(
    input.finderTeams.flatMap((t) => t.players.map((p) => [p.playerId, p] as const)),
  );

  const profiles = profilesFor(input.finderTeams, input.startingSlots, input.isDynasty);
  const myProfile = profiles.get(input.rosterId) ?? null;
  const pulseMine = input.pulse?.find((p) => p.rosterId === input.rosterId) ?? null;
  const direction = myProfile?.direction ?? null;

  // ---- players, stored once ----------------------------------------------
  const players: Record<string, BlueprintPlayer> = {};
  const addPlayer = (p: ResolvedPlayer) => {
    const f = finderById.get(p.id);
    const priced = isPricedPosition(p.position) && !isDefender(p.position);
    const trend = input.trends.get(p.id);
    const value = priced
      ? f && f.hasValue
        ? Math.round(f.value)
        : trend
          ? Math.round(trend.value)
          : null
      : null;
    players[p.id] = {
      id: p.id,
      sleeperId: p.sleeper_id,
      name: p.full_name,
      position: p.position,
      team: p.team,
      value: value !== null && value > 0 ? value : null,
      positionRank: priced ? (mine.playerPositionRanks[p.id] ?? null) : null,
      age: f?.age != null ? round1(f.age) : p.age,
      signal: priced ? (input.signals.get(p.id) ?? null) : null,
    };
  };
  for (const p of mine.players) addPlayer(p);
  const bySleeper = new Map(mine.players.map((p) => [p.sleeper_id, p]));

  // ---- lineup (Sleeper's actual starters, positional) ---------------------
  const lineup: LineupSlot[] = input.alignedSlots.map((slot, i) => {
    const sid = input.rawStarterSleeperIds[i] ?? "";
    const p = sid && sid !== "0" ? bySleeper.get(sid) : undefined;
    return { slot: slot.token, slotLabel: slot.label, slotDescription: slot.description, playerId: p?.id ?? null };
  });
  const starterIds = new Set(lineup.map((l) => l.playerId).filter((x): x is string => x !== null));

  // ---- depth ---------------------------------------------------------------
  const reserve = new Set(input.reserveSleeperIds);
  const taxi = new Set(input.taxiSleeperIds);
  const byValue = (a: string, b: string) =>
    (players[b].value ?? -1) - (players[a].value ?? -1) || players[a].name.localeCompare(players[b].name);
  const active = mine.players.filter((p) => !reserve.has(p.sleeper_id) && !taxi.has(p.sleeper_id));
  const groups = BLUEPRINT_POSITIONS.map((position) => ({
    position,
    playerIds: active.filter((p) => p.position === position).map((p) => p.id).sort(byValue),
  }));
  const otherIds = active
    .filter((p) => !isPricedPosition(p.position) || isDefender(p.position))
    .map((p) => p.id)
    .sort((a, b) => players[a].position.localeCompare(players[b].position) || players[a].name.localeCompare(players[b].name));
  const reserveIds = mine.players.filter((p) => reserve.has(p.sleeper_id)).map((p) => p.id).sort(byValue);
  const taxiIds = mine.players.filter((p) => taxi.has(p.sleeper_id)).map((p) => p.id).sort(byValue);

  // ---- calls -----------------------------------------------------------------
  const surplusIds = new Set(myProfile?.surplus.map((s) => s.playerId) ?? []);
  const callPlayers: CallPlayer[] = mine.players
    .filter((p) => isPricedPosition(p.position) && players[p.id].value !== null)
    .map((p) => ({
      id: p.id,
      position: p.position as BlueprintPosition,
      value: players[p.id].value!,
      isStarter: starterIds.has(p.id),
      age: players[p.id].age,
      yearsExperience: p.years_experience,
      positionRank: players[p.id].positionRank,
      inSurplus: surplusIds.has(p.id),
      signal: players[p.id].signal,
    }));
  const calls = computeCalls(callPlayers, {
    direction: direction ?? "balanced",
    isDynasty: input.isDynasty,
    ageCutoff: input.settings.calls.ageCutoff,
  });

  // ---- buy targets -----------------------------------------------------------
  const others = [...profiles.values()].filter((p) => p.team.rosterId !== input.rosterId);
  const buys = myProfile
    ? computeBuyTargets({
        mine: myProfile,
        others,
        signals: input.signals,
        myRosterId: input.rosterId,
        settings: input.settings.calls,
      })
    : [];
  for (const g of buys) {
    for (const t of g.targets) {
      const f = finderById.get(t.playerId);
      if (!f || players[t.playerId]) continue;
      players[t.playerId] = {
        id: f.playerId,
        sleeperId: f.sleeperId,
        name: f.name,
        position: f.position,
        team: f.team,
        value: f.hasValue ? Math.round(f.value) : null,
        positionRank: mine.playerPositionRanks[f.playerId] ?? null,
        age: f.age !== null ? round1(f.age) : null,
        signal: input.signals.get(f.playerId) ?? null,
      };
    }
  }
  for (const id of input.strategy.playerIds) {
    if (players[id]) continue;
    const f = finderById.get(id);
    if (!f) continue;
    players[id] = {
      id,
      sleeperId: f.sleeperId,
      name: f.name,
      position: f.position,
      team: f.team,
      value: f.hasValue ? Math.round(f.value) : null,
      positionRank: mine.playerPositionRanks[id] ?? null,
      age: f.age !== null ? round1(f.age) : null,
      signal: input.signals.get(id) ?? null,
    };
  }

  // ---- grades ----------------------------------------------------------------
  const pointsRanks = pulseMine
    ? (Object.fromEntries(BLUEPRINT_POSITIONS.map((p) => [p, pulseMine.positionRanks[p] ?? null])) as Record<
        BlueprintPosition,
        number | null
      >)
    : null;
  const { grades, overall } = computeGrades({
    teamCount: T,
    isDynasty: input.isDynasty,
    isSuperflex: input.isSuperflex,
    valueRanks: mine.positionRanks,
    pointsRanks,
    benchValueRank: mine.statRanks.bench,
    depthRank: pulseMine?.scoreDepthRank ?? null,
    picksValueRank: mine.statRanks.picks,
    settings: input.settings.grades,
  });
  const picksGrade = grades.find((g) => g.key === "picks")?.grade ?? null;
  const benchGrade = grades.find((g) => g.key === "bench")!;

  // ---- age -------------------------------------------------------------------
  const agePlayer = (id: string): AgePlayer => ({
    position: players[id]?.position ?? "",
    value: players[id]?.value ?? null,
    age: players[id]?.age ?? null,
  });
  const leagueAge: AgePlayer[] = input.finderTeams.flatMap((t) =>
    t.players.map((p) => ({ position: p.position, value: p.hasValue ? p.value : null, age: p.age })),
  );
  const age = computeAge(mine.players.map((p) => agePlayer(p.id)), leagueAge, input.settings.archetype.youngAge);

  // ---- standing --------------------------------------------------------------
  const status = pulseMine?.status ?? null;
  const cache = mine.cacheRow;
  const standing = {
    overall,
    status: status ? { key: status.key, label: status.label, phrase: status.phrase, reason: status.reason } : null,
    valueArchetype: valueArchetype(status?.key ?? null, input.isDynasty, age.gap, picksGrade, input.settings.archetype),
    rosterArchetype: rosterArchetype(cache?.starter_value ?? 0, cache?.bench_value ?? 0, input.settings.archetype),
    outlook: twoYearOutlook(
      status?.key ?? null,
      input.isDynasty,
      age.gap,
      picksGrade,
      age.youngCoreShare,
      input.settings.archetype,
    ),
    outlookNote: !input.isDynasty ? REDRAFT_OUTLOOK : status === null ? NO_PULSE_STANDING : null,
    standingNote: status === null ? NO_PULSE_STANDING : null,
  };

  // ---- shares, movers --------------------------------------------------------
  const shares = computeShares(
    input.cards.map((c) => ({
      rosterId: c.sleeperRosterId,
      totalValue: c.displayTotalValue,
      pointsFor: c.record.pointsFor,
    })),
    input.rosterId,
    mine.displayOverallRank,
  );
  const trendRows: RosterTrend[] = mine.players
    .filter((p) => isPricedPosition(p.position) && input.trends.has(p.id))
    .map((p) => ({
      playerId: p.id,
      name: p.full_name,
      position: p.position,
      team: p.team,
      sleeperId: p.sleeper_id,
      ...input.trends.get(p.id)!,
    }));
  const movers = computeMovers(trendRows, input.formatTopValue, input.settings.movers);

  // ---- activity --------------------------------------------------------------
  const needs = myProfile
    ? BLUEPRINT_POSITIONS.map((p) => ({ position: p, need: myProfile.positionNeed[p] ?? 0 }))
        .filter((n) => n.need >= input.settings.calls.needMinPoints)
        .sort((a, b) => b.need - a.need)
    : [];
  const activity = computeActivity({
    calls,
    needPositions: needs.map((n) => n.position),
    rankDivergence: pulseMine?.rankDivergence ?? null,
    valueRank: mine.displayOverallRank,
    pulseRank: pulseMine?.pulseRank ?? null,
    teamCount: T,
    buys,
    settings: input.settings.activity,
  });

  // ---- capital, partners, priorities, spotlight -----------------------------
  const capital = input.isDynasty
    ? computeCapital(input.finderTeams, input.rosterId, input.pickSourceDisplay)
    : null;
  const statusLabels = new Map(
    (input.pulse ?? []).map((p) => [p.rosterId, p.status?.label ?? null] as const),
  );
  const partners = myProfile ? computePartners(myProfile, others, statusLabels, input.settings.partners) : [];

  const sellNames = callPlayers
    .filter((p) => calls[p.id]?.call === "sell")
    .sort((a, b) => b.value - a.value)
    .map((p) => players[p.id].name);
  const buildNames = callPlayers
    .filter((p) => calls[p.id]?.call === "build")
    .sort((a, b) => b.value - a.value)
    .map((p) => players[p.id].name);
  const priorities = computePriorities(
    {
      teamCount: T,
      direction,
      positional: grades.filter((g) => isPricedPosition(g.key)),
      needs,
      sellShare: activity.pricedCount > 0 ? activity.sellsPct / 100 : 0,
      sellNames,
      ledger: input.ledger,
      bench: benchGrade.grade !== null ? { grade: benchGrade.grade, rank: benchGrade.valueRank } : null,
      picks:
        input.isDynasty && picksGrade !== null && capital
          ? {
              grade: picksGrade,
              rank: mine.statRanks.picks,
              seasons: capital.seasons.filter((s) => s.value > 0).map((s) => s.season),
            }
          : null,
      ageGap: age.gap,
      mineAge: age.rosterMean,
      activityBand: activity.band,
      risers: movers.risers.map((m) => ({ name: players[m.playerId]?.name ?? "", pct: m.pct })),
      windowLabel: movers.windowLabel,
      buildNames,
      totalValue: mine.displayTotalValue,
      valueRank: mine.displayOverallRank,
    },
    input.settings.priorities.count,
  );

  const weekPlayer = input.spotlightWeek ? bySleeper.get(input.spotlightWeek.sleeperId) : undefined;
  const topValued = callPlayers.slice().sort((a, b) => b.value - a.value)[0];
  const spotInput: SpotlightInput = {
    week:
      input.spotlightWeek && weekPlayer
        ? {
            playerId: weekPlayer.id,
            week: input.spotlightWeek.week,
            points: input.spotlightWeek.points,
            average: input.spotlightWeek.average,
          }
        : null,
    riser: movers.risers[0]
      ? {
          playerId: movers.risers[0].playerId,
          pct: movers.risers[0].pct,
          delta: movers.risers[0].delta,
          windowLabel: movers.windowLabel,
        }
      : null,
    valuable: topValued
      ? {
          playerId: topValued.id,
          value: topValued.value,
          position: topValued.position,
          positionRank: topValued.positionRank,
        }
      : null,
  };

  return {
    modelVersion: BLUEPRINT_MODEL_VERSION,
    generatedAt: input.generatedAt,
    season: input.season,
    sleeperLeagueId: input.sleeperLeagueId,
    rosterId: input.rosterId,
    header: {
      teamName: mine.teamName,
      ownerHandle: mine.ownerSleeperUsername ?? mine.ownerDisplayName,
      ownerAvatarId: mine.ownerAvatarId,
      record: mine.record,
      teamCount: T,
      formatTags: input.formatTags,
      formatDisplay: input.formatDisplay,
      sourceSlug: input.sourceSlug,
      sourceDisplay: input.sourceDisplay,
      pickSourceDisplay: input.pickSourceDisplay,
      isDynasty: input.isDynasty,
      isSuperflex: input.isSuperflex,
      direction,
    },
    players,
    standing,
    grades,
    lineup,
    depth: { groups, reserveIds, taxiIds, otherIds, starterIds: [...starterIds] },
    calls,
    shares,
    age,
    movers,
    activity,
    buys,
    capital,
    priorities,
    strategy: input.strategy.entries,
    partners,
    spotlight: computeSpotlight(spotInput),
    hasDefenders: mine.players.some((p) => isDefender(p.position)),
  };
}

