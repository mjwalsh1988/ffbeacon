"use server";

/**
 * Every write the Draft Tracker makes.
 *
 * SECURITY SHAPE, and it is the same in all seven actions:
 *   1. Get the session. No session, no write.
 *   2. Re-read the tracker with an explicit `user_id = auth user` filter, so a
 *      guessed or forged tracker id resolves to nothing before anything is
 *      spent on it. Row level security would refuse the write anyway; this
 *      turns a database error into an honest sentence on the screen, and it
 *      gives every action the tracker's own limits (how many teams exist) to
 *      validate against.
 *   3. Validate the input against those limits. A team slot outside the room,
 *      a player id that is not a uuid, a name longer than the column allows:
 *      all rejected here rather than passed through.
 *   4. Write.
 *
 * Nothing here trusts a value from the client except as something to validate.
 * The team slot in particular arrives from a dialog the user can see, but it is
 * still checked against the tracker's own team_count before it is stored, and
 * again by a trigger (migration 0220) so the check holds for a caller who skips
 * this file and writes to PostgREST directly.
 *
 * WHAT IS NOT HERE ANY MORE. A `touch()` update that stamped the parent's
 * updated_at after every pick. It was a second round trip on the one code path
 * with a draft clock running against it, and a trigger (migration 0221) now does
 * it inside the same statement.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveFormats } from "@/lib/source";
import {
  clampTeamCount,
  isDraftOrder,
  isTrackingMode,
  isUuid,
  normalizeTeamNames,
} from "@/lib/draft-tracker/order";
import { isTrackerId } from "@/lib/draft-tracker/store";
import { MAX_TRACKERS_PER_USER } from "@/lib/draft-tracker/types";

/** What every action hands back. A failure is a sentence, never a stack. */
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const GENERIC_FAILURE = "That did not save. Try again.";

/**
 * Refresh the saved-drafts list after a change that alters what its cards say.
 *
 * NOT CALLED FROM THE IN-DRAFT ACTIONS, deliberately, and that now includes
 * changing the board's order as well as recording a pick. Everything under
 * /my-beacon is force-dynamic, so there is no cached page for a revalidation to
 * bust; the only thing it does is make the client router refetch the whole board
 * mid draft. Worse, that refetch replaces the pick list the room was handed,
 * and a pick made while it was in flight can be dropped back onto the board.
 * The list page's "Last touched" line being a few minutes stale on a back
 * navigation is the cheaper of the two.
 */
function revalidateList() {
  revalidatePath("/my-beacon/draft-tracker");
}

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

async function requireSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
}

/**
 * The tracker, re-read under the caller's own id. Returns null for a tracker
 * that does not exist, or exists and belongs to somebody else. The caller
 * cannot tell those two apart, which is the point.
 */
async function ownedTracker(session: Session, trackerId: string) {
  if (!isTrackerId(trackerId)) return null;
  const { data } = await session.supabase
    .from("user_draft_trackers")
    .select("id, team_count, tracking_mode, my_team_slot")
    .eq("id", trackerId)
    .eq("user_id", session.userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Validate a team slot against the room it claims to be in. Returns undefined
 * when the slot is outside the room, which the caller turns into a refusal:
 * silently moving a pick to a different manager would be worse than saying no.
 */
function readTeamSlot(raw: number | null | undefined, teamCount: number): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n >= teamCount) return undefined;
  return n;
}

/** Start a draft. Returns the new tracker's id for the caller to navigate to. */
export async function createTracker(input: {
  name: string;
  formatSlug: string;
  orderBy: string;
  trackingMode: string;
  teamCount: number;
  myTeamSlot: number;
  teamNames: string[];
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to start a draft." };

  const name = (input.name ?? "").trim().slice(0, 80) || "My draft";
  if (!isDraftOrder(input.orderBy)) {
    return { ok: false, error: "Pick how you want the players ordered." };
  }
  if (!isTrackingMode(input.trackingMode)) {
    return { ok: false, error: "Pick whether you are tracking one team or all of them." };
  }

  // The format has to be one we actually publish, not any uuid or slug a caller
  // fancies. getActiveFormats is the same list the form was built from.
  const formats = await getActiveFormats(session.supabase);
  const format = formats.find((f) => f.slug === input.formatSlug);
  if (!format) return { ok: false, error: "Pick a format for the draft." };

  const trackingMode = input.trackingMode;
  // The team count is stored whichever way the reader is tracking. It is what
  // turns a pick's position in the recorded order into a draft slot, and 1.04
  // is worth reading whether or not the other eleven managers are named.
  const teamCount = clampTeamCount(input.teamCount);
  // Which seat is theirs only means something when every roster is followed.
  const myTeamSlot =
    trackingMode === "all"
      ? Math.min(Math.max(Math.trunc(Number(input.myTeamSlot)) || 0, 0), teamCount - 1)
      : 0;
  const teamNames =
    trackingMode === "all" ? normalizeTeamNames(input.teamNames, teamCount) : [];

  const { data, error } = await session.supabase
    .from("user_draft_trackers")
    .insert({
      user_id: session.userId,
      name,
      format_config_id: format.id,
      order_by: input.orderBy,
      tracking_mode: trackingMode,
      team_count: teamCount,
      my_team_slot: myTeamSlot,
      team_names: teamNames,
    })
    .select("id")
    .single();

  if (error || !data) {
    // 23514 from the trigger in migration 0220 means the account is at its cap.
    // That one deserves a sentence saying what to do about it.
    if (error?.code === "23514" && error.message.includes("saved drafts")) {
      return {
        ok: false,
        error: `You have ${MAX_TRACKERS_PER_USER} saved drafts, which is the limit. Delete one to start another.`,
      };
    }
    console.error("[draft-tracker] create failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }

  revalidateList();
  return { ok: true, id: data.id };
}

/** Take a player, either for the reader's own team or for somebody else's. */
export async function recordPick(
  trackerId: string,
  playerId: string,
  teamSlot: number | null,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };
  if (!isUuid(playerId)) return { ok: false, error: GENERIC_FAILURE };

  const slot = readTeamSlot(teamSlot, tracker.team_count);
  if (slot === undefined) return { ok: false, error: "That team is not in this draft." };

  // UPSERT, NOT INSERT, and the reason is a real sequence rather than a
  // hypothetical one: tapping Mine and then Gone on the same player half a
  // second apart. A plain insert refuses the second write on the unique
  // constraint, and the screen would then show him as gone while the database
  // still had him on the reader's own team. Writing the slot on conflict makes
  // the last tap the one that counts, which is what the reader just did.
  // created_at is untouched by the update, so pick order survives.
  const { error } = await session.supabase
    .from("user_draft_tracker_picks")
    .upsert(
      { tracker_id: tracker.id, player_id: playerId, team_slot: slot },
      { onConflict: "tracker_id,player_id" },
    );

  if (error) {
    console.error("[draft-tracker] pick failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }

  return { ok: true };
}

/** Put a player back on the board. This is the answer to a mis-tap. */
export async function undoPick(trackerId: string, playerId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };
  if (!isUuid(playerId)) return { ok: false, error: GENERIC_FAILURE };

  const { error } = await session.supabase
    .from("user_draft_tracker_picks")
    .delete()
    .eq("tracker_id", tracker.id)
    .eq("player_id", playerId);

  if (error) {
    console.error("[draft-tracker] undo failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }

  return { ok: true };
}

/** Move a player who is already off the board to a different team. */
export async function reassignPick(
  trackerId: string,
  playerId: string,
  teamSlot: number | null,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };
  if (!isUuid(playerId)) return { ok: false, error: GENERIC_FAILURE };

  const slot = readTeamSlot(teamSlot, tracker.team_count);
  if (slot === undefined) return { ok: false, error: "That team is not in this draft." };

  const { error } = await session.supabase
    .from("user_draft_tracker_picks")
    .update({ team_slot: slot })
    .eq("tracker_id", tracker.id)
    .eq("player_id", playerId);

  if (error) {
    console.error("[draft-tracker] reassign failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }

  return { ok: true };
}

/** Change the ordering of a draft that is already running. */
export async function setTrackerOrder(
  trackerId: string,
  orderBy: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };
  if (!isDraftOrder(orderBy)) return { ok: false, error: GENERIC_FAILURE };

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };

  const { error } = await session.supabase
    .from("user_draft_trackers")
    .update({ order_by: orderBy, updated_at: new Date().toISOString() })
    .eq("id", tracker.id)
    .eq("user_id", session.userId);

  if (error) {
    console.error("[draft-tracker] order failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  return { ok: true };
}

/** Rename the teams in the room, or the draft itself. */
export async function renameTracker(input: {
  trackerId: string;
  name?: string;
  teamNames?: string[];
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };

  const tracker = await ownedTracker(session, input.trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };

  const patch: {
    updated_at: string;
    name?: string;
    team_names?: string[];
  } = { updated_at: new Date().toISOString() };
  if (typeof input.name === "string") {
    const name = input.name.trim().slice(0, 80);
    if (!name) return { ok: false, error: "Give the draft a name." };
    patch.name = name;
  }
  if (input.teamNames) {
    patch.team_names = normalizeTeamNames(input.teamNames, tracker.team_count);
  }

  const { error } = await session.supabase
    .from("user_draft_trackers")
    .update(patch)
    .eq("id", tracker.id)
    .eq("user_id", session.userId);

  if (error) {
    console.error("[draft-tracker] rename failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  revalidateList();
  return { ok: true };
}

/** Mark a draft finished, or reopen one. */
export async function setTrackerStatus(
  trackerId: string,
  status: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };
  if (status !== "active" && status !== "complete") {
    return { ok: false, error: GENERIC_FAILURE };
  }

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };

  const { error } = await session.supabase
    .from("user_draft_trackers")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", tracker.id)
    .eq("user_id", session.userId);

  if (error) {
    console.error("[draft-tracker] status failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  revalidateList();
  return { ok: true };
}

/** Clear every pick and start the board over. */
export async function clearPicks(trackerId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to change." };

  const { error } = await session.supabase
    .from("user_draft_tracker_picks")
    .delete()
    .eq("tracker_id", tracker.id);

  if (error) {
    console.error("[draft-tracker] clear failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  revalidateList();
  return { ok: true };
}

/** Delete a saved draft and everything in it. */
export async function deleteTracker(trackerId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "Sign in to track a draft." };

  const tracker = await ownedTracker(session, trackerId);
  if (!tracker) return { ok: false, error: "That draft is not yours to delete." };

  const { error } = await session.supabase
    .from("user_draft_trackers")
    .delete()
    .eq("id", tracker.id)
    .eq("user_id", session.userId);

  if (error) {
    console.error("[draft-tracker] delete failed", error);
    return { ok: false, error: GENERIC_FAILURE };
  }
  revalidateList();
  return { ok: true };
}
