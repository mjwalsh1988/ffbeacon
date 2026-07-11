import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireFfBeaconHeader, privateJson } from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/signal-scout/me/stats
 *
 * The caller's own Signal Scout aggregate row, camelCased. Login required.
 * A user who has never played has no row: that is a normal 200 with
 * { stats: null }, not an error. No caching (personal data).
 */

export async function GET(req: Request) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return privateJson({ error: "login_required" }, 401);
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("signal_scout_user_stats")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      return privateJson({ stats: null }, 200);
    }

    return privateJson(
      {
        stats: {
          totalPoints: data.total_points,
          roundsPlayed: data.rounds_played,
          roundsWon: data.rounds_won,
          roundsSolvedLate: data.rounds_solved_late,
          roundsFailed: data.rounds_failed,
          roundsSkipped: data.rounds_skipped,
          roundsBurned: data.rounds_burned,
          totalHints: data.total_hints,
          totalWrongGuesses: data.total_wrong_guesses,
          currentSignalStreak: data.current_signal_streak,
          bestSignalStreak: data.best_signal_streak,
          currentDailyStreak: data.current_daily_streak,
          bestDailyStreak: data.best_daily_streak,
          lastPlayedDate: data.last_played_date,
          firstPlayedAt: data.first_played_at,
          updatedAt: data.updated_at,
          hiddenFromLeaderboards: data.hidden_from_leaderboards,
        },
      },
      200,
    );
  } catch (err) {
    console.error("[signal-scout] me/stats failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
