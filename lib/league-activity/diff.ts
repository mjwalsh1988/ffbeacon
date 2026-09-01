/**
 * What changed between two syncs.
 *
 * Everything in this file is PURE. It takes the league as we had it stored, the
 * league as Sleeper just described it, and returns the events that difference
 * implies. No clock, no database, no Sleeper. That is what makes it testable at
 * all: the interesting cases here are a manager swapping two players in a
 * lineup and a commissioner quietly moving the trade deadline, and neither is
 * reproducible against a live league.
 *
 * THE THREE RULES THIS FILE ENFORCES
 *
 * 1. NO PRIOR STATE MEANS NO EVENTS. The first time we ever see a league there
 *    is nothing to compare against. Reporting "lineup changed" there would be
 *    inventing a history out of our own ignorance.
 *
 * 2. A STALE COMPARISON IS NOT A CHANGE WE WATCHED. A league nobody has opened
 *    since September, opened again in December, has a different lineup. Saying
 *    "spotted a lineup change" over a three month window is technically true
 *    and useless, so lineup and reserve events are dropped when the window is
 *    wider than OBSERVATION_LIMIT_MS. Settings and people changes survive a
 *    wide window, because "the trade deadline moved at some point since
 *    September" is still worth knowing and there is no better record of it.
 *
 * 3. AN EMPTY ARRAY IS NOT EVIDENCE OF AN EMPTY LEAGUE. `getSleeperLeagueUsers`
 *    returns `[]` both when a league has no members and when the request
 *    FAILED, and the same is true of `getSleeperRosters`. Diffing a real prior
 *    snapshot against a failed fetch reads as every manager leaving at once, and
 *    those cards are permanent: nothing rewrites a row, and the next sync sees
 *    no arrival because the stored rows were never deleted. CLAUDE.md already
 *    carries this as an absolute rule for Power Pulse, written after the same
 *    trap fired there. So each half of the diff is gated on its own side of the
 *    data being present.
 *
 * 4. A PLAYER WHO LEFT THE ROSTER IS THE TRANSACTION'S STORY, NOT THE LINEUP'S.
 *    Every waiver Wednesday would otherwise produce two cards saying the same
 *    thing in different words. Lineup events only name players who were on the
 *    roster before AND after, so a swap is a swap and an add is an add.
 *
 * THE DEDUPE KEY IS BUILT FROM THE PRIOR SYNC TIME, NEVER FROM `now`. Two
 * server instances rendering the same cold league read the same stored row, so
 * they compute the same `observedFrom` and the same content hash, so they
 * compute the same key and the unique index collapses them into one row. Keying
 * on the detection time instead would give each instance its own key and post
 * the same lineup swap twice, which is exactly the failure the relay's ledger
 * was built to avoid.
 */

import {
  ACTIVITY_CATEGORY_OF,
  type ActivityKind,
  type ActivityFieldChange,
  type PendingActivity,
} from "./types";
import { isReportableSetting } from "./labels";

/**
 * The widest window a lineup or reserve change may be spotted across.
 *
 * Seven days, because a league synced inside a week was plausibly watched: the
 * change happened in a window a reader can still place against a real NFL week.
 * Beyond that the sentence degrades into "at some point this season", which is
 * not worth a card.
 */
export const OBSERVATION_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Settings whose change is already reported by a card of its own.
 *
 * `settings.num_teams` and `leagues.total_rosters` are the same fact arriving
 * through two fields. Without this the league gets two cards for one change.
 */
const SETTINGS_COVERED_ELSEWHERE = new Set(["num_teams"]);

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                  */
/* -------------------------------------------------------------------------- */

export interface SnapshotRoster {
  sleeperRosterId: number;
  ownerUserId: string | null;
  playerIds: string[];
  starterIds: string[];
  reserveIds: string[];
  taxiIds: string[];
}

export interface SnapshotUser {
  sleeperUserId: string;
  displayName: string | null;
  teamName: string | null;
  avatar: string | null;
  isCommissioner: boolean;
}

export interface SnapshotDraft {
  sleeperDraftId: string;
  status: string | null;
  season: number | null;
}

/** The league as one sync saw it. Everything the diff can reason about. */
export interface LeagueSnapshot {
  name: string;
  status: string | null;
  totalRosters: number | null;
  scoringSettings: Record<string, unknown>;
  rosterPositions: string[];
  settings: Record<string, unknown>;
  rosters: SnapshotRoster[];
  users: SnapshotUser[];
  drafts: SnapshotDraft[];
}

export interface DiffOptions {
  /** Stamped on every event, and the end of the observation window. */
  now: string;
  /**
   * The previous sync's timestamp. Null when the league has never completed
   * one, which is the first-sight case: nothing is emitted.
   */
  observedFrom: string | null;
  season: number | null;
  /** The live NFL week, for the week badge on a lineup card. */
  week: number | null;
}

/* -------------------------------------------------------------------------- */
/* The diff                                                                   */
/* -------------------------------------------------------------------------- */

export function diffLeagueSnapshots(
  prior: LeagueSnapshot | null,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  // Rule 1. Nothing to compare against is not the same as nothing happening.
  if (!prior || !opts.observedFrom) return [];

  const events: PendingActivity[] = [];
  const windowMs = Date.parse(opts.now) - Date.parse(opts.observedFrom);
  // A negative window means the clocks disagree; treat it as unusable rather
  // than as a very fresh observation.
  const lineupsAreWatchable =
    Number.isFinite(windowMs) && windowMs >= 0 && windowMs <= OBSERVATION_LIMIT_MS;

  // Rule 3, applied per data source. "We had some and now there are none" is
  // the shape a failed fetch takes, and it is indistinguishable from a real
  // emptying, so neither is reported. A league that genuinely had no members
  // and still has none passes the guard and diffs to nothing anyway.
  const membersKnown = present(next.users, prior.users);
  const rostersKnown = present(next.rosters, prior.rosters);
  const scoringKnown = presentKeys(next.scoringSettings, prior.scoringSettings);
  const settingsKnown = presentKeys(next.settings, prior.settings);
  const slotsKnown = present(next.rosterPositions, prior.rosterPositions);

  events.push(...diffLeagueFields(prior, next, opts));
  if (scoringKnown) events.push(...diffScoring(prior, next, opts));
  if (slotsKnown) events.push(...diffRosterPositions(prior, next, opts));
  if (settingsKnown) events.push(...diffSettings(prior, next, opts));
  events.push(...diffDrafts(prior, next, opts));
  if (membersKnown) events.push(...diffUsers(prior, next, opts));
  if (rostersKnown) events.push(...diffRosterOwners(prior, next, opts));

  if (lineupsAreWatchable && rostersKnown) {
    events.push(...diffLineups(prior, next, opts));
    events.push(...diffReserves(prior, next, opts));
  }

  return events;
}

/** False exactly when the prior side had entries and the new side has none. */
function present(next: unknown[], prior: unknown[]): boolean {
  return next.length > 0 || prior.length === 0;
}

function presentKeys(
  next: Record<string, unknown>,
  prior: Record<string, unknown>,
): boolean {
  return Object.keys(next).length > 0 || Object.keys(prior).length === 0;
}

/* -------------------------------------------------------------------------- */
/* League-level fields                                                        */
/* -------------------------------------------------------------------------- */

function diffLeagueFields(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const out: PendingActivity[] = [];

  if (prior.name !== next.name && next.name) {
    out.push(
      event("league_renamed", opts, {
        scope: "league",
        payload: { from: prior.name, to: next.name },
      }),
    );
  }

  if ((prior.status ?? null) !== (next.status ?? null)) {
    out.push(
      event("league_status_change", opts, {
        scope: "league",
        payload: { from: prior.status ?? null, to: next.status ?? null },
      }),
    );
  }

  if (
    prior.totalRosters != null &&
    next.totalRosters != null &&
    prior.totalRosters !== next.totalRosters
  ) {
    out.push(
      event("team_count_change", opts, {
        scope: "league",
        payload: { from: prior.totalRosters, to: next.totalRosters },
      }),
    );
  }

  return out;
}

/**
 * Scoring.
 *
 * Every changed key goes on ONE card rather than one card per key. A
 * commissioner switching from standard to PPR moves half a dozen values in a
 * single edit, and six cards for one edit is six times the noise for the same
 * information.
 */
function diffScoring(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const changes = diffNumericMaps(prior.scoringSettings, next.scoringSettings);
  if (changes.length === 0) return [];
  return [
    event("scoring_change", opts, {
      scope: "league",
      payload: { changes },
    }),
  ];
}

function diffSettings(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const changes = diffNumericMaps(prior.settings, next.settings).filter(
    (c) => isReportableSetting(c.key) && !SETTINGS_COVERED_ELSEWHERE.has(c.key),
  );
  if (changes.length === 0) return [];
  return [
    event("league_setting_change", opts, {
      scope: "league",
      payload: { changes },
    }),
  ];
}

/**
 * Roster slots.
 *
 * Compared as a MULTISET, not a set. A league going from two receiver slots to
 * three has added one WR, and a set comparison would see "WR was there before,
 * WR is there now" and report nothing at all.
 */
function diffRosterPositions(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const before = countBy(prior.rosterPositions);
  const after = countBy(next.rosterPositions);
  const added: string[] = [];
  const removed: string[] = [];

  for (const slot of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(slot) ?? 0) - (before.get(slot) ?? 0);
    for (let i = 0; i < delta; i += 1) added.push(slot);
    for (let i = 0; i < -delta; i += 1) removed.push(slot);
  }

  if (added.length === 0 && removed.length === 0) return [];
  return [
    event("roster_positions_change", opts, {
      scope: "league",
      payload: {
        added,
        removed,
        fromCount: prior.rosterPositions.length,
        toCount: next.rosterPositions.length,
      },
    }),
  ];
}

function diffDrafts(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const before = new Map(prior.drafts.map((d) => [d.sleeperDraftId, d]));
  const out: PendingActivity[] = [];

  for (const draft of next.drafts) {
    const was = before.get(draft.sleeperDraftId);
    // A draft we have never seen is not a status CHANGE. A league's first sync
    // after a draft is created would otherwise announce "draft scheduled" for
    // a draft that has existed since August.
    if (!was) continue;
    if ((was.status ?? null) === (draft.status ?? null)) continue;
    out.push(
      event("draft_status_change", opts, {
        scope: `draft:${draft.sleeperDraftId}`,
        season: draft.season ?? opts.season,
        payload: {
          from: was.status ?? null,
          to: draft.status ?? null,
          draftId: draft.sleeperDraftId,
        },
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

function diffUsers(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const before = new Map(prior.users.map((u) => [u.sleeperUserId, u]));
  const after = new Map(next.users.map((u) => [u.sleeperUserId, u]));
  const rosterOf = new Map(
    next.rosters
      .filter((r) => r.ownerUserId)
      .map((r) => [r.ownerUserId as string, r.sleeperRosterId]),
  );
  const priorRosterOf = new Map(
    prior.rosters
      .filter((r) => r.ownerUserId)
      .map((r) => [r.ownerUserId as string, r.sleeperRosterId]),
  );
  const out: PendingActivity[] = [];

  for (const [id, user] of after) {
    if (before.has(id)) continue;
    out.push(
      event("manager_joined", opts, {
        scope: `user:${id}`,
        rosterIds: rosterOf.has(id) ? [rosterOf.get(id) as number] : [],
        payload: {
          sleeperUserId: id,
          displayName: user.displayName,
          teamName: user.teamName,
          rosterId: rosterOf.get(id) ?? null,
        },
      }),
    );
  }

  for (const [id, user] of before) {
    if (after.has(id)) continue;
    out.push(
      event("manager_left", opts, {
        scope: `user:${id}`,
        rosterIds: priorRosterOf.has(id) ? [priorRosterOf.get(id) as number] : [],
        payload: {
          sleeperUserId: id,
          displayName: user.displayName,
          teamName: user.teamName,
          rosterId: priorRosterOf.get(id) ?? null,
        },
      }),
    );
  }

  for (const [id, user] of after) {
    const was = before.get(id);
    if (!was) continue;

    if (was.isCommissioner !== user.isCommissioner) {
      out.push(
        event("commissioner_change", opts, {
          scope: `commish:${id}`,
          rosterIds: rosterOf.has(id) ? [rosterOf.get(id) as number] : [],
          payload: {
            sleeperUserId: id,
            label: user.displayName ?? user.teamName ?? null,
            granted: user.isCommissioner,
          },
        }),
      );
    }

    const identity: ActivityFieldChange[] = [];
    if (norm(was.teamName) !== norm(user.teamName)) {
      identity.push({ key: "team_name", from: was.teamName, to: user.teamName });
    }
    if (norm(was.displayName) !== norm(user.displayName)) {
      identity.push({
        key: "display_name",
        from: was.displayName,
        to: user.displayName,
      });
    }
    // The avatar is a content hash, so its VALUE is meaningless to a reader.
    // The card says the picture changed and shows the new one; it never prints
    // the hash on either side.
    if (norm(was.avatar) !== norm(user.avatar)) {
      identity.push({ key: "avatar", from: null, to: null });
    }
    if (identity.length > 0) {
      out.push(
        event("team_identity_change", opts, {
          scope: `identity:${id}`,
          rosterIds: rosterOf.has(id) ? [rosterOf.get(id) as number] : [],
          payload: {
            sleeperUserId: id,
            rosterId: rosterOf.get(id) ?? null,
            handle: user.displayName ?? was.displayName ?? null,
            changes: identity,
          },
        }),
      );
    }
  }

  return out;
}

/**
 * A roster changing hands.
 *
 * Separate from manager_joined and manager_left on purpose: those two say a
 * person arrived or went, and this one says WHICH TEAM they took over, which is
 * the half a league actually cares about. A commissioner replacing an inactive
 * manager mid-season fires all three, and the three sentences are different.
 */
function diffRosterOwners(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const before = new Map(prior.rosters.map((r) => [r.sleeperRosterId, r]));
  const labelOf = (
    snapshot: LeagueSnapshot,
    userId: string | null,
  ): string | null => {
    if (!userId) return null;
    const u = snapshot.users.find((x) => x.sleeperUserId === userId);
    return u?.displayName ?? u?.teamName ?? null;
  };
  const out: PendingActivity[] = [];

  for (const roster of next.rosters) {
    const was = before.get(roster.sleeperRosterId);
    if (!was) continue;
    if ((was.ownerUserId ?? null) === (roster.ownerUserId ?? null)) continue;
    out.push(
      event("roster_owner_change", opts, {
        scope: `owner:${roster.sleeperRosterId}`,
        rosterIds: [roster.sleeperRosterId],
        payload: {
          rosterId: roster.sleeperRosterId,
          fromUserId: was.ownerUserId ?? null,
          fromLabel: labelOf(prior, was.ownerUserId ?? null),
          toUserId: roster.ownerUserId ?? null,
          toLabel: labelOf(next, roster.ownerUserId ?? null),
        },
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Lineups                                                                    */
/* -------------------------------------------------------------------------- */

function diffLineups(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const before = new Map(prior.rosters.map((r) => [r.sleeperRosterId, r]));
  const out: PendingActivity[] = [];

  for (const roster of next.rosters) {
    const was = before.get(roster.sleeperRosterId);
    if (!was) continue;

    // Rule 3. Only players the roster held on BOTH sides of the window can be
    // described as a lineup decision; anyone else arrived or left, and the
    // transaction feed already says so.
    const heldThroughout = new Set(
      roster.playerIds.filter((id) => was.playerIds.includes(id)),
    );

    const wasStarting = new Set(was.starterIds);
    const isStarting = new Set(roster.starterIds);

    const started = [...isStarting].filter(
      (id) => heldThroughout.has(id) && !wasStarting.has(id),
    );
    const benched = [...wasStarting].filter(
      (id) => heldThroughout.has(id) && !isStarting.has(id),
    );

    if (started.length === 0 && benched.length === 0) continue;

    out.push(
      event("lineup_change", opts, {
        scope: `lineup:${roster.sleeperRosterId}`,
        rosterIds: [roster.sleeperRosterId],
        playerIds: [...started, ...benched],
        payload: { rosterId: roster.sleeperRosterId, started, benched },
      }),
    );
  }

  return out;
}

function diffReserves(
  prior: LeagueSnapshot,
  next: LeagueSnapshot,
  opts: DiffOptions,
): PendingActivity[] {
  const before = new Map(prior.rosters.map((r) => [r.sleeperRosterId, r]));
  const out: PendingActivity[] = [];

  for (const roster of next.rosters) {
    const was = before.get(roster.sleeperRosterId);
    if (!was) continue;

    const heldThroughout = new Set(
      roster.playerIds.filter((id) => was.playerIds.includes(id)),
    );
    const keep = (ids: string[]) => ids.filter((id) => heldThroughout.has(id));

    const toReserve = keep(diffIds(roster.reserveIds, was.reserveIds));
    const fromReserve = keep(diffIds(was.reserveIds, roster.reserveIds));
    const toTaxi = keep(diffIds(roster.taxiIds, was.taxiIds));
    const fromTaxi = keep(diffIds(was.taxiIds, roster.taxiIds));

    if (
      toReserve.length === 0 &&
      fromReserve.length === 0 &&
      toTaxi.length === 0 &&
      fromTaxi.length === 0
    ) {
      continue;
    }

    out.push(
      event("reserve_move", opts, {
        scope: `reserve:${roster.sleeperRosterId}`,
        rosterIds: [roster.sleeperRosterId],
        playerIds: [...toReserve, ...fromReserve, ...toTaxi, ...fromTaxi],
        payload: {
          rosterId: roster.sleeperRosterId,
          toReserve,
          fromReserve,
          toTaxi,
          fromTaxi,
        },
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function event(
  kind: ActivityKind,
  opts: DiffOptions,
  parts: {
    scope: string;
    payload: Record<string, unknown>;
    rosterIds?: number[];
    playerIds?: string[];
    season?: number | null;
  },
): PendingActivity {
  const payload = parts.payload;
  return {
    kind,
    // observedFrom, not `now`: see the header. Two detectors racing on the same
    // stored row must arrive at the same key.
    dedupeKey: `${kind}:${parts.scope}:${opts.observedFrom}:${fingerprint(payload)}`,
    occurredAt: opts.now,
    precision: "observed",
    observedFrom: opts.observedFrom,
    season: parts.season !== undefined ? parts.season : opts.season,
    week: ACTIVITY_CATEGORY_OF[kind] === "lineup" ? opts.week : null,
    rosterIds: parts.rosterIds ?? [],
    playerIds: parts.playerIds ?? [],
    payload,
  };
}

/** In `a` and not in `b`. Order-insensitive, duplicates collapsed. */
function diffIds(a: string[], b: string[]): string[] {
  const has = new Set(b);
  return [...new Set(a)].filter((id) => !has.has(id));
}

function countBy(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Changed keys across two Sleeper maps.
 *
 * A key present on one side and absent on the other counts: Sleeper drops a
 * scoring key entirely when a commissioner sets it back to nothing, and
 * treating an absence as "unchanged" would hide exactly that edit.
 *
 * Numbers are compared as numbers, so `1` and `1.0` do not read as a change.
 */
export function diffNumericMaps(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ActivityFieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: ActivityFieldChange[] = [];

  for (const key of [...keys].sort()) {
    const a = normalizeScalar(before?.[key]);
    const b = normalizeScalar(after?.[key]);
    if (a === b) continue;
    out.push({ key, from: a, to: b });
  }

  return out;
}

function normalizeScalar(value: unknown): number | string | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return value.trim() !== "" && Number.isFinite(n) ? n : value;
  }
  return null;
}

/**
 * A short, stable fingerprint of an event's contents.
 *
 * FNV-1a over the JSON with sorted keys. It is not a security hash and does not
 * need to be: its only job is to make two DIFFERENT changes produce two
 * different dedupe keys, and the same change produce the same one on every
 * machine. `JSON.stringify` alone would not do, because key order is insertion
 * order and two detectors can build the same object in different orders.
 */
export function fingerprint(payload: unknown): string {
  const json = stableStringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
