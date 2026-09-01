/**
 * NO `import "server-only"` HERE, DELIBERATELY.
 *
 * This module is reached from `lib/league-pulse.ts`, which is imported by CLI
 * scripts (`npm run pulse:league`, the relay runner, the power-rankings recalc)
 * that run under tsx with no Next.js resolver. `server-only` does not resolve
 * there, so adding the guard breaks every one of those scripts at import time
 * rather than protecting anything. league-pulse itself omits it for the same
 * reason. The service-role client is passed in by the caller, so nothing here
 * can reach a secret on its own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type {
  SleeperDraft,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperRoster,
} from "@/lib/sleeper";
import {
  diffLeagueSnapshots,
  type LeagueSnapshot,
  type SnapshotRoster,
} from "./diff";
import { ACTIVITY_CATEGORY_OF, type PendingActivity } from "./types";

/**
 * Reading the league before we overwrite it, and writing down what changed.
 *
 * `pulseLeagueCore` upserts the league, its rosters and its members straight
 * over whatever was stored, and until now nothing ever read the old values.
 * That is why a lineup edit, a scoring change or a manager swap left no trace
 * anywhere: the evidence was destroyed by the sync that could have reported it.
 *
 * So the sync now takes a SNAPSHOT first. One extra read of a few dozen small
 * rows, in parallel with the Sleeper fetch it was going to do anyway, and then
 * `diff.ts` (pure, tested) decides what that difference means.
 *
 * NOTHING HERE MAY FAIL A SYNC. A league page that will not render because the
 * activity log could not be written is a strictly worse product than a league
 * page with a gap in its activity log. Every entry point catches, logs, and
 * returns.
 */

type ServiceClient = SupabaseClient<Database>;

/** The snapshot plus the timestamp it was taken at, which bounds the window. */
export interface CapturedSnapshot {
  snapshot: LeagueSnapshot;
  /**
   * `leagues.last_pulsed_at` as it stood before this sync.
   *
   * Null on a league that has never completed one, which is the first-sight
   * case: `diffLeagueSnapshots` emits nothing.
   */
  observedFrom: string | null;
  season: number | null;
}

/** The stored league row the snapshot is built around. */
export interface StoredLeagueRow {
  id: string;
  name: string;
  season: number;
  status: string | null;
  total_rosters: number | null;
  scoring_settings: unknown;
  roster_positions: unknown;
  metadata: unknown;
  last_pulsed_at: string | null;
}

/**
 * Read the stored league's children exactly as they are now.
 *
 * TAKES THE LEAGUE ROW RATHER THAN FETCHING IT. `pulseLeagueCore` has already
 * read that row a dozen lines earlier for its cache check, so re-reading it here
 * made the snapshot two round trips deep instead of one, on the critical path of
 * every full sync. Passing it in also means a league on its very first sync
 * (`existing` is null) costs no query at all, where before it spent one to
 * discover there was nothing to find.
 *
 * Returns null when there is no league row yet and when any read fails, which
 * are handled identically on purpose: in both cases we have no trustworthy
 * prior state, and the correct response is to write no events rather than guess.
 */
export async function captureLeagueSnapshot(
  supabase: ServiceClient,
  league: StoredLeagueRow | null,
): Promise<CapturedSnapshot | null> {
  if (!league) return null;
  const sleeperLeagueId = league.id;
  try {
    const [rosterRead, userRead, draftRead] = await Promise.all([
      supabase
        .from("rosters")
        .select("sleeper_roster_id, owner_user_id, player_ids, starter_ids, reserve_ids, taxi_ids")
        .eq("league_id", league.id),
      supabase
        .from("league_users")
        .select("sleeper_user_id, display_name, team_name, avatar, is_commissioner")
        .eq("league_id", league.id),
      supabase
        .from("league_drafts")
        .select("sleeper_draft_id, status, season")
        .eq("league_id", league.id),
    ]);

    // A FAILED READ IS NOT AN EMPTY LEAGUE, and PostgREST reports both as
    // `data: []`. Taking the error branch as a snapshot would hand the diff an
    // empty prior, which reads as every manager joining at once, and those
    // cards are permanent. The doc comment above already promises this
    // behaviour; before this check it did not deliver it.
    if (rosterRead.error || userRead.error || draftRead.error) {
      console.warn(
        `[league-activity] snapshot child read failed for ${sleeperLeagueId}:`,
        (rosterRead.error ?? userRead.error ?? draftRead.error)?.message,
      );
      return null;
    }
    const rosters = rosterRead.data;
    const users = userRead.data;
    const drafts = draftRead.data;

    const meta = (league.metadata ?? {}) as Record<string, unknown>;

    return {
      observedFrom: league.last_pulsed_at ?? null,
      season: league.season == null ? null : Number(league.season),
      snapshot: {
        name: league.name,
        status: league.status ?? null,
        totalRosters: league.total_rosters ?? null,
        scoringSettings: asRecord(league.scoring_settings),
        rosterPositions: asSlotList(league.roster_positions),
        // `settings` is not a column of its own; it lives inside the raw
        // Sleeper object we already store verbatim on `leagues.metadata`.
        settings: asRecord(meta.settings),
        rosters: (rosters ?? []).map((r) => ({
          sleeperRosterId: Number(r.sleeper_roster_id),
          ownerUserId: r.owner_user_id ?? null,
          playerIds: asStringList(r.player_ids),
          starterIds: asStringList(r.starter_ids),
          reserveIds: asStringList(r.reserve_ids),
          taxiIds: asStringList(r.taxi_ids),
        })),
        users: (users ?? []).map((u) => ({
          sleeperUserId: u.sleeper_user_id,
          displayName: u.display_name ?? null,
          teamName: u.team_name ?? null,
          avatar: u.avatar ?? null,
          isCommissioner: Boolean(u.is_commissioner),
        })),
        drafts: (drafts ?? []).map((d) => ({
          sleeperDraftId: d.sleeper_draft_id,
          status: d.status ?? null,
          season: d.season == null ? null : Number(d.season),
        })),
      },
    };
  } catch (err) {
    console.warn(
      `[league-activity] snapshot read failed for ${sleeperLeagueId}:`,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * The league as Sleeper just described it, in the same shape as the stored one.
 *
 * Built from the payloads `pulseLeagueCore` already has in hand, so detection
 * costs no extra Sleeper request. The two sides go through the same normalisers
 * (`asStringList` below) so a difference in the diff is a real difference in the
 * league rather than a difference in how two code paths spell an empty array.
 */
export function snapshotFromSleeper(
  league: SleeperLeague,
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
  drafts: SleeperDraft[],
  prior: LeagueSnapshot | null,
): LeagueSnapshot {
  // WE HAVE NO COMMISSIONER SIGNAL FROM SLEEPER, and `upsertLeagueUsers` says
  // so at length: `is_owner` on the /users response means "active member", not
  // "commissioner", and overloading it would hand force-refresh to every
  // co-owner. So the flag is carried forward from what is already stored rather
  // than recomputed. Reading it as false on this side would make every league
  // whose flag was set by hand announce that its commissioner had been demoted.
  // A CONSEQUENCE WORTH STATING: `diffUsers`'s commissioner branch therefore
  // cannot fire at all today. Both sides read the stored flag, and
  // `upsertLeagueUsers` writes it as false unconditionally, so even a
  // service-role flip is erased before the next diff. The kind exists in the
  // schema, the category map and the renderer so that the day a real signal
  // arrives, populating this set is the only change needed.
  const commissionerIds = new Set(
    (prior?.users ?? []).filter((u) => u.isCommissioner).map((u) => u.sleeperUserId),
  );

  return {
    name: league.name,
    status: league.status ?? null,
    totalRosters: league.total_rosters ?? null,
    scoringSettings: (league.scoring_settings ?? {}) as Record<string, unknown>,
    // The SAME normaliser as the stored side. `asStringList` strips "0" and
    // "", which is right for player ids and wrong for slot tokens, so slots get
    // their own. Before this the two sides disagreed about how to spell an
    // empty entry, which is exactly the difference the diff would have reported
    // as a real change.
    rosterPositions: asSlotList(league.roster_positions),
    settings: (league.settings ?? {}) as Record<string, unknown>,
    rosters: rosters.map(
      (r): SnapshotRoster => ({
        sleeperRosterId: Number(r.roster_id),
        ownerUserId: r.owner_id ?? null,
        // Sleeper writes "0" into an unfilled slot. It is a placeholder, not a
        // player, and letting it through would make an empty flex look like a
        // lineup change every time a manager filled or emptied one.
        playerIds: cleanIds(r.players),
        starterIds: cleanIds(r.starters),
        reserveIds: cleanIds(r.reserve),
        taxiIds: cleanIds(r.taxi),
      }),
    ),
    users: users.map((u) => ({
      sleeperUserId: u.user_id,
      displayName: u.display_name ?? null,
      teamName: readTeamName(u),
      avatar: u.avatar ?? null,
      isCommissioner: commissionerIds.has(u.user_id),
    })),
    drafts: drafts.map((d) => ({
      sleeperDraftId: d.draft_id,
      status: (d as { status?: string | null }).status ?? null,
      season: d.season == null ? null : Number(d.season),
    })),
  };
}

/**
 * Diff, then write.
 *
 * Called after the upserts have landed, so an event is never recorded for a
 * state that failed to persist. Returns the number of rows the insert actually
 * created; a duplicate is not an error and is not counted.
 */
export async function recordLeagueChanges(
  supabase: ServiceClient,
  leagueRowId: string,
  captured: CapturedSnapshot | null,
  next: LeagueSnapshot,
  opts: { now?: Date; week?: number | null } = {},
): Promise<number> {
  try {
    if (!captured) return 0;
    const now = (opts.now ?? new Date()).toISOString();
    const events = diffLeagueSnapshots(captured.snapshot, next, {
      now,
      observedFrom: captured.observedFrom,
      season: captured.season,
      week: opts.week ?? null,
    });
    return await writeActivity(supabase, leagueRowId, events);
  } catch (err) {
    console.warn(
      `[league-activity] change detection failed for league ${leagueRowId}:`,
      (err as Error).message,
    );
    return 0;
  }
}

/**
 * Insert events, letting the unique index settle every collision.
 *
 * `ignoreDuplicates` means a re-detected event is a no-op rather than an error,
 * which is what makes the whole feature safe to run on every sync: the same
 * lineup swap seen by three concurrent renders writes one row and returns
 * quietly twice.
 */
export async function writeActivity(
  supabase: ServiceClient,
  leagueRowId: string,
  events: PendingActivity[],
): Promise<number> {
  if (events.length === 0) return 0;

  const rows: Database["public"]["Tables"]["league_activity"]["Insert"][] = events.map(
    (e) => ({
      league_id: leagueRowId,
      kind: e.kind,
      category: ACTIVITY_CATEGORY_OF[e.kind],
      // Prefixed with the league so two leagues detecting the same change on
      // the same day cannot claim each other's key.
      dedupe_key: `${leagueRowId}:${e.dedupeKey}`,
      occurred_at: e.occurredAt,
      occurred_at_precision: e.precision,
      observed_from: e.observedFrom,
      season: e.season,
      week: e.week,
      roster_ids: e.rosterIds,
      player_ids: e.playerIds,
      payload: e.payload as unknown as Json,
    }),
  );

  let written = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("league_activity")
      // Matches the unique index from migration 0236. The league is part of the
      // key itself now rather than only part of the string we build for it.
      .upsert(slice, { onConflict: "league_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.warn(`[league-activity] write failed for league ${leagueRowId}: ${error.message}`);
      break;
    }
    written += data?.length ?? 0;
  }

  return written;
}

/* -------------------------------------------------------------------------- */
/* Normalisers                                                                */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Roster slot tokens. Every non-empty string is a real slot, "0" included. */
function asSlotList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "0" && v !== "");
}

function cleanIds(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v !== "0" && v !== "");
}

/**
 * A manager's team name.
 *
 * Sleeper hangs it off `metadata.team_name` on the league user rather than
 * giving it a field, and plenty of managers never set one at all.
 */
function readTeamName(user: SleeperLeagueUser): string | null {
  const meta = (user.metadata ?? {}) as Record<string, unknown>;
  const name = meta.team_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
