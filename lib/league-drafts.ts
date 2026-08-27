/**
 * The one read of `league_drafts`, and the one rule for choosing between drafts.
 *
 * WHY THIS EXISTS
 * A league can hold more than one draft for the same season. Migration 0029
 * dropped the unique (league_id, season) constraint because that is real, and
 * one production league carries two completed 23-round 2026 startups whose seat
 * maps DISAGREE about which team sits where. Two modules need to pick between
 * them, and if they pick differently the same pick gets labelled off one draft
 * and priced off the other:
 *
 *   lib/league-pick-slots.ts     labels a traded pick "1.04"
 *   lib/league-startup-picks.ts  decides which player that seat produced
 *
 * They used to read start time from DIFFERENT columns (the `start_time`
 * timestamptz versus `metadata.start_time`, Sleeper's raw epoch), so a row whose
 * metadata predates the raw-object upsert, or is the `'{}'` column default from
 * migration 0027, sorted at the bottom in one module and at a real timestamp in
 * the other. Both now call `chooseDraftPerSeason` on the same normalized rows,
 * so they cannot disagree.
 *
 * The read is wrapped in React `cache()`, so a page that needs draft slots AND
 * startup picks AND projected pick positions pays for one round trip rather than
 * three. The cache key includes the client, so an admin-client read and an
 * anon-client read stay separate, which is what we want: they see different rows.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { draftShapeFromMeta, type DraftShape } from "@/lib/on-the-clock/draft-derive";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Upper bounds on a draft's shape.
 *
 * `league_drafts.settings` is third-party Sleeper JSON preserved verbatim under
 * the Original Source Object Preservation rule, so it is not trusted arithmetic.
 * Consumers multiply rounds by teams to build a pick grid, and a settings blob
 * claiming ten million rounds would allocate until the process dies. The real
 * extremes we hold are 33 rounds and 20 teams, so these are generous.
 */
export const MAX_DRAFT_ROUNDS = 60;
export const MAX_DRAFT_TEAMS = 40;

/** One synced draft, normalized. */
export interface LeagueDraftRow {
  sleeperDraftId: string;
  season: number;
  status: string | null;
  isComplete: boolean;
  /** Sleeper draft type: "snake" | "linear" | "auction". */
  type: string | null;
  rounds: number;
  teams: number;
  shape: DraftShape;
  /** roster_id -> draft seat (1..teams). */
  rosterToSeat: Map<number, number>;
  startedAtMs: number | null;
  lastPickedAtMs: number | null;
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toEpochMs(value: unknown): number | null {
  const n = toInt(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Read and normalize every draft for a league. Memoized per request.
 *
 * A row is dropped only when it carries no usable seat map, because every
 * consumer here is asking a seat question. Rounds and teams are clamped rather
 * than dropped so a malformed settings blob degrades to "we cannot place this
 * pick" instead of taking the process with it.
 */
export const loadLeagueDrafts = cache(
  async (supabase: AnySupabase, leagueRowId: string): Promise<LeagueDraftRow[]> => {
    const { data: rows, error } = await (supabase as SupabaseClient<Database>)
      .from("league_drafts")
      .select("sleeper_draft_id, season, status, type, start_time, settings, slot_to_roster_id, metadata")
      .eq("league_id", leagueRowId);

    if (error || !rows) return [];

    const out: LeagueDraftRow[] = [];
    for (const row of rows) {
      const season = toInt(row.season);
      if (season === null) continue;

      const rawSlots = row.slot_to_roster_id;
      if (!rawSlots || typeof rawSlots !== "object" || Array.isArray(rawSlots)) continue;
      const rosterToSeat = new Map<number, number>();
      for (const [slotStr, rosterRaw] of Object.entries(rawSlots as Record<string, unknown>)) {
        const seat = toInt(slotStr);
        const rosterId = toInt(rosterRaw);
        if (seat === null || rosterId === null || seat < 1) continue;
        rosterToSeat.set(rosterId, seat);
      }
      if (rosterToSeat.size === 0) continue;

      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const metaSettings = (meta.settings ?? {}) as Record<string, unknown>;

      const rounds = toInt(settings.rounds ?? metaSettings.rounds) ?? 0;
      const declaredTeams = toInt(settings.teams ?? metaSettings.teams) ?? 0;
      // The seat map is the same fact by another route, and it is the one the
      // pick maths actually indexes into. When the two disagree the seat map
      // wins, because a stale `teams` would roll high seats into the next round.
      //
      // The HIGHEST seat, not the count. Sleeper emits slot_to_roster_id with
      // null values for unassigned slots and those entries are skipped above, so
      // a map of eleven entries can still run to seat 12, and sizing the round
      // at eleven would put seat 11 of round 2 one pick early.
      let maxSeat = 0;
      for (const seat of rosterToSeat.values()) maxSeat = Math.max(maxSeat, seat);
      const teams = Math.max(declaredTeams, maxSeat);

      const reversalRound = toInt(metaSettings.reversal_round ?? settings.reversal_round) ?? 0;

      // start_time is a timestamptz column (League Pulse converts Sleeper's
      // epoch on the way in). metadata.start_time is the raw epoch. Prefer the
      // column and fall back, so a row with either one still sorts correctly.
      const parsedColumn = row.start_time ? Date.parse(row.start_time) : NaN;
      const startedAtMs = Number.isFinite(parsedColumn)
        ? parsedColumn
        : toEpochMs(meta.start_time);

      out.push({
        sleeperDraftId: row.sleeper_draft_id,
        season,
        status: row.status ?? null,
        isComplete: (row.status ?? "").toLowerCase() === "complete",
        type: row.type ?? null,
        rounds: rounds > 0 ? Math.min(rounds, MAX_DRAFT_ROUNDS) : 0,
        teams: teams > 0 ? Math.min(teams, MAX_DRAFT_TEAMS) : 0,
        shape: draftShapeFromMeta({
          draftType: row.type ?? null,
          settings: { reversal_round: reversalRound > 0 ? reversalRound : 0 },
        } as unknown as Parameters<typeof draftShapeFromMeta>[0]),
        rosterToSeat,
        startedAtMs,
        lastPickedAtMs: toEpochMs(meta.last_picked),
      });
    }
    return out;
  },
);

/**
 * True when `next` should replace `current` as the season's live draft.
 *
 * A total order, so the outcome never depends on the order rows arrive in:
 * latest start, then a completed draft over an unfinished one, then the higher
 * Sleeper id (snowflake ids order by creation).
 */
export function preferLaterDraft(current: LeagueDraftRow, next: LeagueDraftRow): boolean {
  const a = current.startedAtMs ?? -1;
  const b = next.startedAtMs ?? -1;
  if (a !== b) return b > a;
  if (current.isComplete !== next.isComplete) return next.isComplete;
  return next.sleeperDraftId > current.sleeperDraftId;
}

/** The live draft for each season, chosen by `preferLaterDraft`. */
export function chooseDraftPerSeason(rows: LeagueDraftRow[]): Map<number, LeagueDraftRow> {
  const out = new Map<number, LeagueDraftRow>();
  for (const row of rows) {
    const current = out.get(row.season);
    if (!current || preferLaterDraft(current, row)) out.set(row.season, row);
  }
  return out;
}
