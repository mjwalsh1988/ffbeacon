/**
 * Code defaults for League Relay.
 *
 * What the relay runs on when the settings row is missing, empty, or older than
 * the schema. A missing row must degrade to a relay that posts NOTHING rather
 * than to one that posts everything, which is the opposite of how a read-only
 * feature's defaults work and is deliberate: this writes into a channel other
 * people read.
 *
 * EVERY MESSAGE TYPE IS OFF BY DEFAULT AND HAS ITS OWN WEBHOOK. An admin turns
 * one on, points it at a channel, presses Preview, reads what would go out, and
 * only then leaves it on. Nothing about shipping this file starts a post.
 */

/** The four things the relay can say. */
export type RelayMessageType = "trade" | "waiver" | "matchup_preview" | "matchup_recap";

export const RELAY_MESSAGE_TYPES: readonly RelayMessageType[] = [
  "trade",
  "waiver",
  "matchup_preview",
  "matchup_recap",
];

export const RELAY_MESSAGE_LABEL: Record<RelayMessageType, string> = {
  trade: "Trades",
  waiver: "Waivers and free agents",
  matchup_preview: "Matchup previews",
  matchup_recap: "Matchup recaps",
};

export const RELAY_MESSAGE_HINT: Record<RelayMessageType, string> = {
  trade:
    "Every trade, run through Signal Check and the trade impact model, as a writeup with a poll.",
  waiver:
    "Waiver claims, free agent adds and drops, with what the move is projected to do to the lineup.",
  matchup_preview:
    "Wednesday. One headline game and one undercard, three days before kickoff.",
  matchup_recap: "Tuesday. One writeup an hour until last week's slate is covered.",
};

/** Per-message-type configuration. Same shape for all four. */
export interface RelayChannelSettings {
  /** Off means this type is never built and never posted. */
  enabled: boolean;
  /** A row in discord_webhooks, or null. Null with enabled on is refused. */
  webhook_id: string | null;
  /** Attach a Discord poll to this message type. */
  poll: boolean;
  /** How long that poll stays open, in hours. */
  poll_hours: number;
  /** Role ids permitted to be pinged. Nothing else can be, ever. */
  mention_role_ids: string[];
}

export interface LeagueRelaySettings {
  /** Master gate. Off means the cron still ticks and does nothing. */
  enabled: boolean;

  sync: {
    /**
     * Leagues one 15-minute run will resync.
     *
     * A community league resync is a full Sleeper round trip. Ordered by least
     * recently synced, so a capped run rotates rather than starving the tail.
     */
    max_leagues_per_run: number;
    /**
     * The oldest a transaction may be and still be written up, in hours.
     *
     * The watermark stops a NEWLY nominated league replaying its season. This
     * stops an OUTAGE doing the same thing: four hours of failed crons should
     * post the four hours of moves, not forty. Anything older is marked as
     * handled without being sent.
     */
    max_transaction_age_hours: number;
    /**
     * Messages one league may send in one run.
     *
     * A league that processes eleven waiver claims at 3am on Wednesday would
     * otherwise fire eleven webhook posts back to back. The rest are picked up
     * on the next tick fifteen minutes later, oldest first.
     */
    max_messages_per_league_per_run: number;
  };

  channels: Record<RelayMessageType, RelayChannelSettings>;

  waivers: {
    /**
     * At or under this many moves in one processing run, every claim gets its
     * own full review. Above it, the whole run becomes ONE digest message.
     *
     * A Wednesday morning waiver run is eleven results at once, and eleven
     * separate embeds is a wall nobody reads. Three is the point where the
     * channel is still a conversation rather than a feed.
     */
    digest_threshold: number;
    /**
     * Write up a move that drops a player and adds nobody.
     *
     * On by default now that a busy run is digested rather than posted one
     * message at a time: cutting a startable player is news, and hiding it was
     * the relay deciding on the league's behalf what counted.
     */
    include_bare_drops: boolean;
  };

  matchups: {
    /**
     * Which Eastern weekday the previews go out. 0 is Sunday, 3 is Wednesday.
     *
     * Wednesday because the first game of an NFL week is usually Thursday
     * night, so a Wednesday post lands the day before kickoff with lineups
     * still movable.
     */
    preview_weekday: number;
    /** The Eastern hour previews go out, 0 to 23. */
    preview_hour: number;
    /** Post the best-versus-best game. */
    preview_headline: boolean;
    /**
     * Post a second, deliberately unglamorous game.
     *
     * The bottom of the table is where the comedy is, and a league where only
     * the contenders get written about is a league where eight managers never
     * see their own team mentioned.
     */
    preview_undercard: boolean;

    /** Which Eastern weekday the recaps go out. 2 is Tuesday. */
    recap_weekday: number;
    /** The Eastern hour the first recap goes out. */
    recap_start_hour: number;
    /**
     * The last Eastern hour a recap may go out.
     *
     * One an hour from the start hour until the slate is covered. A twelve team
     * league is six games, so 11am to 4pm covers it; the bound exists so a
     * league that somehow has more games than hours stops at a civilised time
     * and finishes next Tuesday rather than posting through the night.
     */
    recap_end_hour: number;
  };

  /**
   * The voice.
   *
   * Every writeup is built from deterministic templates, never a language
   * model, for the same reason Signal Check's reasons are: every sentence has
   * to be checkable against a figure on the same screen. This only chooses HOW
   * SHARP the templates are allowed to be.
   */
  voice: {
    /**
     * 0 is a straight report. 1 is the full sarcastic register, including lines
     * at a team's expense.
     */
    snark: number;
    /** Include the value and odds tables under the prose. */
    show_numbers: boolean;
    /** Link back to the FF Beacon page for the league. */
    link_back: boolean;
  };
}

export const DEFAULT_RELAY_CHANNEL: RelayChannelSettings = {
  enabled: false,
  webhook_id: null,
  poll: false,
  poll_hours: 48,
  mention_role_ids: [],
};

export const DEFAULT_LEAGUE_RELAY_SETTINGS: LeagueRelaySettings = {
  enabled: false,

  sync: {
    max_leagues_per_run: 5,
    max_transaction_age_hours: 24,
    max_messages_per_league_per_run: 4,
  },

  channels: {
    // A trade is the one message worth voting on, so it is the one that
    // defaults to carrying a poll if it is ever switched on.
    trade: { ...DEFAULT_RELAY_CHANNEL, poll: true },
    waiver: { ...DEFAULT_RELAY_CHANNEL },
    matchup_preview: { ...DEFAULT_RELAY_CHANNEL, poll: true, poll_hours: 96 },
    matchup_recap: { ...DEFAULT_RELAY_CHANNEL },
  },

  waivers: {
    digest_threshold: 3,
    include_bare_drops: true,
  },

  matchups: {
    preview_weekday: 3,
    preview_hour: 11,
    preview_headline: true,
    preview_undercard: true,
    recap_weekday: 2,
    recap_start_hour: 11,
    recap_end_hour: 20,
  },

  voice: {
    snark: 0.8,
    show_numbers: true,
    link_back: true,
  },
};

/** Bounds the admin form and the validator both hold to. */
export const RELAY_SETTING_BOUNDS = {
  max_leagues_per_run: { min: 1, max: 25 },
  max_transaction_age_hours: { min: 1, max: 168 },
  max_messages_per_league_per_run: { min: 1, max: 10 },
  digest_threshold: { min: 1, max: 25 },
  /** Discord caps a poll at 32 days; an hour is the shortest useful window. */
  poll_hours: { min: 1, max: 768 },
  hour: { min: 0, max: 23 },
  weekday: { min: 0, max: 6 },
  snark: { min: 0, max: 1 },
} as const;

/** Sunday-first, matching Date#getDay and the weekday settings above. */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
