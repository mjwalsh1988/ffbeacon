/**
 * Code defaults for Would You Rather.
 *
 * These are what the game runs on when the settings row is missing, empty, or
 * older than the schema. A missing row must degrade to a working game rather
 * than to a broken one, which is the same contract Power Pulse and Signal Scout
 * settings hold.
 *
 * THE DISCORD POST IS OFF BY DEFAULT, ON PURPOSE. It writes to a channel other
 * people read. Nothing that posts outward should start posting the moment it
 * ships; an admin turns it on once they have chosen a webhook and looked at
 * what the first message would say.
 */

import type { LeagueCategoryKey } from "@/lib/league-category";

export interface WouldYouRatherSettings {
  /** Master gate. Off means the page renders an "off right now" state. */
  game_enabled: boolean;
  /** Whether a signed-out visitor may play at all. */
  guest_play_enabled: boolean;
  /** How many trades a signed-out visitor may vote on before signing in. */
  guest_vote_limit: number;

  pool: {
    /** A side receiving fewer than this many assets is not a game round. */
    min_assets_per_side: number;
    /** Include dynasty startup draft trades in the pool. */
    include_startup_trades: boolean;
    /**
     * Require at least one real player somewhere in the trade.
     *
     * A 2026 4th for a 2026 4th grades perfectly well and is a terrible round:
     * there is nothing to know and nothing to argue about. On by default.
     */
    require_player_asset: boolean;
    /**
     * Prefer trades from leagues that already have a Positional WAR curve.
     *
     * The reveal is richer when it can say what a player is worth in THAT
     * league, and the curves exist only for leagues somebody has opened. This
     * biases the pool towards those without excluding the rest: a league with
     * no curve is still pooled when no better group is in the sample window.
     * It never causes a curve to be COMPUTED, which is forbidden off the deep
     * view (see CLAUDE.md, Positional WAR).
     */
    prefer_leagues_with_war: boolean;
    /**
     * How many candidate trades the pool builder grades in one pass. Grading is
     * the expensive half, so this bounds the work a cold request can do.
     */
    candidate_batch_size: number;
  };

  reveal: {
    /** Show the community vote graph after voting. */
    show_community_results: boolean;
    /** Show the full Signal Check verdict after voting. */
    show_signal_check: boolean;
    /** Show each team's Power Pulse standing after voting. */
    show_team_context: boolean;
    /** Show per-player Positional WAR after voting. */
    show_positional_war: boolean;
    /** Show 30-day value movement per player after voting. */
    show_value_trends: boolean;
  };

  discord: {
    /** Off by default. Nothing posts outward until an admin says so. */
    enabled: boolean;
    /**
     * The fallback channel. A row in discord_webhooks, or null.
     *
     * Used for any league type that has no channel of its own below. With every
     * route left empty this is the single channel the game posted to before
     * per-type routing existed, which is why it stays the fallback rather than
     * being replaced by the routes.
     */
    webhook_id: string | null;
    /**
     * One channel per league type, so a dynasty trade lands in the dynasty room
     * and a best ball trade in the best ball room.
     *
     * A null entry means "use webhook_id". A league type with neither is not
     * posted at all, which is a legible silence; dropping it into whichever
     * channel happened to be configured is not.
     *
     * Two types pointed at the same webhook are ONE destination and share one
     * post per scheduled hour. That is what keeps a single-webhook setup posting
     * once an hour rather than four times. See lib/would-you-rather/routing.ts.
     */
    routes: Record<LeagueCategoryKey, string | null>;
    /**
     * Which hours of the day a poll goes out, in America/New_York, 0 to 23.
     *
     * THIS IS THE SCHEDULE, NOT THE CRON. The cron ticks every hour and asks
     * this list whether the hour it woke up in is one an admin picked. So the
     * frequency is whatever is in here: three entries is three posts a day, one
     * entry is one. The default is the 8am / 3pm / 8pm Eastern cadence.
     *
     * Hours rather than "HH:MM" because the tick is hourly: a half-past time
     * would silently never fire, and a setting that cannot happen is worse than
     * one that is coarse.
     */
    post_hours: number[];
    /** How long a Discord poll stays open, in hours. */
    poll_hours: number;
    /** Role ids permitted to be pinged in the post. Nothing else can be. */
    mention_role_ids: string[];
  };
}

export const DEFAULT_WOULD_YOU_RATHER_SETTINGS: WouldYouRatherSettings = {
  game_enabled: true,
  guest_play_enabled: true,
  guest_vote_limit: 2,

  pool: {
    min_assets_per_side: 1,
    include_startup_trades: true,
    require_player_asset: true,
    prefer_leagues_with_war: true,
    candidate_batch_size: 12,
  },

  reveal: {
    show_community_results: true,
    show_signal_check: true,
    show_team_context: true,
    show_positional_war: true,
    show_value_trends: true,
  },

  discord: {
    enabled: false,
    webhook_id: null,
    routes: {
      dynasty: null,
      redraft: null,
      "best-ball-dynasty": null,
      "best-ball-redraft": null,
    },
    post_hours: [8, 15, 20],
    poll_hours: 72,
    mention_role_ids: [],
  },
};

/** Bounds the admin form and the validator both hold to. */
export const WYR_SETTING_BOUNDS = {
  guest_vote_limit: { min: 0, max: 20 },
  min_assets_per_side: { min: 1, max: 5 },
  candidate_batch_size: { min: 1, max: 50 },
  /** Discord caps a poll at 32 days; one hour is the shortest useful window. */
  poll_hours: { min: 1, max: 768 },
  post_hours_max_count: 24,
} as const;
