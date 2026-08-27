/**
 * Reads for the Draft Tracker's own rows.
 *
 * Every function here goes through the caller's Supabase client, so row level
 * security is the boundary: a tracker id belonging to somebody else returns
 * nothing rather than throwing, and there is no path that reads a tracker
 * without the reader's session attached. The explicit `user_id` filter on the
 * list read is belt and braces, not the lock.
 *
 * Picks are never cached. They change the moment a button is pressed, and a
 * cached pick list would put a drafted player back on the board.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isDraftOrder, isTrackingMode, isUuid, parseTeamNames } from "./order";
import type {
  DraftTracker,
  DraftTrackerSummary,
  TrackerPick,
  TrackerStatus,
} from "./types";

type Client = SupabaseClient<Database>;

/** PostgREST returns at most 1000 rows per request. */
const PAGE = 1000;

const TRACKER_COLUMNS =
  "id, name, format_config_id, order_by, tracking_mode, team_count, my_team_slot, team_names, status, created_at, updated_at, format_configs!inner(slug, display_name)";

type TrackerRow = {
  id: string;
  name: string;
  format_config_id: string;
  order_by: string;
  tracking_mode: string;
  team_count: number;
  my_team_slot: number;
  team_names: unknown;
  status: string;
  created_at: string;
  updated_at: string;
  format_configs: { slug: string; display_name: string };
};

/**
 * Shape a raw row into the tracker the UI reads. Every enum-ish column is
 * re-validated rather than cast: the database checks them on write, but a row
 * written before a later migration must still render instead of crashing a
 * draft that is halfway done.
 */
function shapeTracker(row: TrackerRow): DraftTracker {
  const status: TrackerStatus = row.status === "complete" ? "complete" : "active";
  return {
    id: row.id,
    name: row.name,
    formatConfigId: row.format_config_id,
    formatSlug: row.format_configs.slug,
    formatLabel: row.format_configs.display_name,
    orderBy: isDraftOrder(row.order_by) ? row.order_by : "value",
    trackingMode: isTrackingMode(row.tracking_mode) ? row.tracking_mode : "mine",
    teamCount: row.team_count,
    myTeamSlot: row.my_team_slot,
    teamNames: parseTeamNames(row.team_names),
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A tracker id has to look like a uuid before it is worth a round trip. */
export const isTrackerId = isUuid;

/**
 * Every draft this user has saved, most recently touched first, with its pick
 * counts.
 *
 * WHY THE COUNTS COME FROM A VIEW. The card needs two integers per draft, one of
 * which is a count filtered on a column of the PARENT row (how many picks are on
 * the reader's own team). PostgREST's embedded `(count)` aggregate cannot
 * express that, and the obvious workaround, embedding every pick row and
 * counting in JavaScript, ships up to 30,000 rows to render fifty numbers. The
 * view (migration 0221) computes both in the database and runs with the
 * caller's own rights, so the owner-only policies still apply.
 *
 * The order is `updated_at`, which the card calls "Last touched" and which a
 * trigger now stamps whenever a pick lands. A draft somebody is in the middle of
 * belongs above one they have not opened since March.
 */
export async function listTrackers(
  supabase: Client,
  userId: string,
): Promise<DraftTrackerSummary[]> {
  const [trackerResult, countResult] = await Promise.all([
    supabase
      .from("user_draft_trackers")
      .select(TRACKER_COLUMNS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("user_draft_tracker_pick_counts")
      .select("tracker_id, pick_count, my_pick_count"),
  ]);

  const counts = new Map<string, { pick: number; mine: number }>();
  for (const row of countResult.data ?? []) {
    if (!row.tracker_id) continue;
    counts.set(row.tracker_id, {
      pick: Number(row.pick_count ?? 0),
      mine: Number(row.my_pick_count ?? 0),
    });
  }

  return ((trackerResult.data ?? []) as unknown as TrackerRow[]).map((row) => {
    const tracker = shapeTracker(row);
    const count = counts.get(row.id);
    return {
      ...tracker,
      pickCount: count?.pick ?? 0,
      myPickCount: count?.mine ?? 0,
    };
  });
}

/**
 * One tracker plus its picks in the order they were made, or null when the id
 * does not resolve to a tracker this reader owns.
 *
 * The two reads run together: the pick read keys on the tracker id alone and is
 * scoped by RLS whatever the tracker read returns, so making it wait buys
 * nothing and costs a round trip on every board load.
 */
export async function loadTracker(
  supabase: Client,
  trackerId: string,
): Promise<{ tracker: DraftTracker; picks: TrackerPick[] } | null> {
  if (!isTrackerId(trackerId)) return null;

  const [trackerResult, picks] = await Promise.all([
    supabase.from("user_draft_trackers").select(TRACKER_COLUMNS).eq("id", trackerId).maybeSingle(),
    loadPicks(supabase, trackerId),
  ]);

  if (!trackerResult.data) return null;

  return {
    tracker: shapeTracker(trackerResult.data as unknown as TrackerRow),
    picks,
  };
}

/**
 * Every pick on a tracker, oldest first.
 *
 * Paged. A draft cannot currently reach 1000 picks (the board caps at 900
 * players and a player can be taken once), but the cap that keeps it under the
 * limit is a constant in another file, and raising it would otherwise put
 * drafted players silently back on the board.
 */
async function loadPicks(supabase: Client, trackerId: string): Promise<TrackerPick[]> {
  const out: TrackerPick[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_draft_tracker_picks")
      .select("player_id, team_slot, created_at")
      .eq("tracker_id", trackerId)
      .order("created_at", { ascending: true })
      .order("player_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      out.push({
        playerId: row.player_id,
        teamSlot: row.team_slot,
        createdAt: row.created_at,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}
