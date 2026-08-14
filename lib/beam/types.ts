/**
 * BEAM: Beacon Engine for Answers and Metrics.
 *
 * The shared vocabulary for the whole feature. Everything here is pure types and
 * constants, importable from a client component.
 *
 * THE ONE BOUNDARY THAT MATTERS
 *
 *   raw text -> INTERPRETER -> BeamRequest -> CAPABILITY -> result -> PRESENTER -> BeamAnswer
 *
 * The interpreter is the ONLY thing that ever sees what a person typed. A
 * capability receives validated parameters and resolved player ids; a presenter
 * receives a typed result. Neither can be handed a raw string.
 *
 * That is not tidiness for its own sake. V2 replaces the deterministic
 * interpreter with an LLM, and the whole point of this shape is that the swap is
 * one new file implementing BeamInterpreter. The model routes the question; it
 * never produces a number, and it never asserts a player id (it proposes a name
 * string, which goes through the same resolver as everything else). That is what
 * keeps an answer unhallucinatable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ScoringKey } from "@/lib/player-profile";
import type { BeamSettings } from "./default-settings";

export type AnyBeamClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/* ------------------------------------------------------------------ */
/* Capability identity                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every question type BEAM can answer. Adding one means adding a member here, a
 * capability module, and its phrasings to the lexicon. Nothing else changes.
 */
export const CAPABILITY_IDS = [
  "rankings.top",
  "player.season.stat",
  "player.stat.line",
  "player.compare.stat",
  "player.compare.verdict",
  "player.weeks.projection",
  "player.projection",
  "player.compare.projection",
  "player.reliability",
  "player.compare.reliability",
  "player.value",
  "player.rank",
  "player.bio",
  "glossary.term",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export function isCapabilityId(value: unknown): value is CapabilityId {
  return (
    typeof value === "string" && (CAPABILITY_IDS as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ */
/* The season clock                                                    */
/* ------------------------------------------------------------------ */

/**
 * What "this year" and "last year" mean right now.
 *
 * These are three different numbers and conflating them is the single easiest
 * way to give a confidently wrong answer. In August the NFL's current season is
 * already the new one, but no game has been played, so a bare stat question has
 * to fall back to the most recent season we actually hold rows for.
 */
export type BeamSeasonClock = {
  /** The season the NFL is in, per Sleeper. May have zero stat rows. */
  currentSeason: number;
  /** The season before currentSeason. What "last year" literally means. */
  previousSeason: number;
  /** The newest season with regular-season rows in player_stats. */
  latestStatSeason: number;
  /** True when currentSeason has no stat rows yet (preseason / offseason). */
  currentSeasonHasStats: boolean;
  /** Oldest season we hold. Questions below this get a clean "no data" answer. */
  earliestStatSeason: number;
  /** Sleeper's phase: pre | regular | post | off. Null when Sleeper is down. */
  phase: string | null;
  /** Sleeper's live week, when it published one. */
  week: number | null;
};

/* ------------------------------------------------------------------ */
/* Request context                                                     */
/* ------------------------------------------------------------------ */

/**
 * Everything a capability is allowed to know, resolved once per request.
 *
 * Format and source come from the site-wide resolver chain (URL, then the signed
 * in user's saved preference, then cookie, then the registry default) exactly
 * like every other surface, so an answer about value never silently uses a
 * different format from the rankings page the reader just left.
 */
export type BeamContext = {
  /** Request-scoped read client. Respects RLS. */
  supabase: SupabaseClient<Database>;
  /** Service-role client. Settings, logging, and Power Pulse settings only. */
  admin: SupabaseClient<Database>;
  formatSlug: string;
  formatConfigId: string | null;
  formatDisplay: string;
  scoringKey: ScoringKey;
  isDynasty: boolean;
  isSuperflex: boolean;
  /** Null when no source is active for this format. */
  sourceSlug: string | null;
  sourceDisplay: string | null;
  clock: BeamSeasonClock;
  settings: BeamSettings;
};

/* ------------------------------------------------------------------ */
/* What the interpreter produces                                       */
/* ------------------------------------------------------------------ */

/** One thing the interpreter matched, kept for the log and the admin debug view. */
export type BeamEvidence = {
  kind: "stat" | "player" | "season" | "position" | "team" | "lens" | "head" | "comparator";
  /** The exact substring that matched. */
  text: string;
  /** What it resolved to (a stat id, a player id, a season number). */
  value: string;
};

export type BeamRequest = {
  capability: CapabilityId;
  /** Validated by the capability's own zod schema before run() is called. */
  params: Record<string, unknown>;
  confidence: number;
  evidence: BeamEvidence[];
};

/** One thing the reader can pick to resolve an ambiguity. */
export type BeamClarifyOption = {
  /** Opaque to the UI. Sent back as the answer to the clarification. */
  value: string;
  label: string;
  /** Second line: position, team, last active season. */
  detail: string | null;
  /** The full sentence a screen reader should hear for this option. */
  speech: string;
};

export type BeamClarifyKind = "player" | "stat" | "season";

export type BeamClarification = {
  kind: BeamClarifyKind;
  /** The question put to the reader. Names what was typed. */
  prompt: string;
  options: BeamClarifyOption[];
  /**
   * The original question with the ambiguous span replaced by a placeholder.
   * Picking an option rewrites the question and re-asks, so a clarification is
   * one round trip and never loses the rest of the sentence.
   */
  template: string;
};

export type BeamUnsupportedReason =
  | "no-player"
  | "no-intent"
  | "unsupported-stat"
  | "no-data"
  /** The question is about the reader's own league, which BEAM cannot see. */
  | "out-of-scope"
  /** We found the player, but he has no current value or ranking. */
  | "not-ranked"
  | "too-many-players"
  | "capability-disabled"
  | "error";

export type BeamInterpretation =
  | { kind: "request"; request: BeamRequest }
  | { kind: "clarify"; clarification: BeamClarification }
  | { kind: "unsupported"; reason: BeamUnsupportedReason; detail?: string };

/**
 * The swap point. V1 ships DeterministicInterpreter; V2 adds LlmInterpreter and
 * beam_settings.interpreter.strategy picks between them (or chains them).
 */
export interface BeamInterpreter {
  readonly id: string;
  interpret(text: string, ctx: BeamContext): Promise<BeamInterpretation>;
}

/* ------------------------------------------------------------------ */
/* What a capability produces                                          */
/* ------------------------------------------------------------------ */

/** One labelled number or short phrase under the headline. */
export type BeamFact = {
  label: string;
  value: string;
  /** Optional plain-language note. Rendered, and read aloud, after the value. */
  hint?: string | null;
};

/**
 * One row of a ranked list.
 *
 * Deliberately thin. A leaderboard is a browse surface: rank, face, name, and
 * the two things that identify a player at a glance. Anything more turns it
 * into a worse copy of the rankings page, which is one link away.
 */
export type BeamPlayerRow = {
  rank: number;
  name: string;
  slug: string;
  position: string | null;
  team: string | null;
  /** For the headshot. Null renders the position-coloured placeholder. */
  sleeperId: string | null;
};

export type BeamPlayerTable = {
  /** Screen-reader caption, e.g. "Top 10 quarterbacks in Redraft PPR". */
  caption: string;
  rows: BeamPlayerRow[];
  /** Rows per page. The card pages client-side; nothing refetches. */
  pageSize: number;
};

export type BeamLink = {
  href: string;
  label: string;
};

/**
 * Where the numbers came from. Rendered as a footnote and announced after the
 * facts, so an answer never presents a format-dependent number without saying
 * which format it is.
 */
export type BeamAnswerContext = {
  formatDisplay: string | null;
  sourceDisplay: string | null;
  /** ISO timestamp. Rendered through formatEastern, never toLocaleString. */
  asOf: string | null;
  /** Free-text provenance, e.g. "Season totals from Sleeper game logs." */
  note: string | null;
};

export type BeamAnswer = {
  /** One sentence. The whole answer if the reader reads nothing else. */
  headline: string;
  /**
   * Long-form prose, when the answer IS prose. A glossary definition is a
   * paragraph, not a measurement, and forcing it through `facts` renders it in
   * half a card width with a label beside it, which reads like a spreadsheet
   * cell that overflowed. Blank lines separate paragraphs.
   *
   * Facts stay the right home for anything with a label and a value. Use this
   * only for text meant to be read as sentences.
   */
  body?: string | null;
  /**
   * A ranked list of players, rendered as a paginated table. Separate from
   * `facts` because a fact is a label and a value, and a leaderboard is neither.
   */
  table?: BeamPlayerTable | null;
  /**
   * What the live region announces. Usually the headline plus the facts read as
   * a sentence, because a visual two-column fact grid does not read aloud in a
   * useful order.
   */
  speech: string;
  facts: BeamFact[];
  context: BeamAnswerContext;
  links: BeamLink[];
  /** Stated limits on the answer. Never decoration. */
  caveats: string[];
};

/* ------------------------------------------------------------------ */
/* The capability contract                                             */
/* ------------------------------------------------------------------ */

/**
 * How a capability tells the scorer what shape of question it answers.
 * Declaring it next to the code that answers it is what keeps adding a question
 * type to one file.
 */
export type BeamMatcher = {
  /** Starting score before slots are counted. */
  base: number;
  required: BeamSlot[];
  optional: BeamSlot[];
  /** Question heads that fit, e.g. "how many". Matching one adds a bonus. */
  heads: string[];
  /** How many players this capability takes. */
  playerCount: 0 | 1 | 2;
};

export type BeamSlot =
  | "player"
  | "stat"
  | "season"
  | "weeks"
  /**
   * The reader asked for a projection in so many words ("project", "pace",
   * "extrapolate"). A slot rather than a scoring bonus because it has to
   * DISQUALIFY: a week-range total and a week-range projection otherwise score
   * identically, and answering "how many yards in weeks 2 to 8" with a full
   * season extrapolation is a different question confidently answered.
   */
  | "project"
  /** The reader asked what a player is projected to score. */
  | "projection"
  /** The reader asked how often the projection has been beaten. */
  | "reliability"
  /** The reader asked for a ranked list rather than about one player. */
  | "leaderboard"
  | "lens"
  | "term"
  | "position";

export interface BeamCapability<TParams, TResult> {
  readonly id: CapabilityId;
  /** Admin-facing name. Shown in the settings kill-switch list and the log. */
  readonly label: string;
  /** One line for the admin, describing the question shape it answers. */
  readonly description: string;
  readonly matcher: BeamMatcher;
  /** Example questions. These become the on-page suggestion chips. */
  readonly examples: string[];
  /**
   * Which player scope the resolver should use. Stat and bio questions search
   * every player we hold; value, rank, and comparison questions are restricted
   * to currently-ranked players, because there is no current value for a retired
   * one.
   */
  readonly playerScope: "historical" | "current";
  /**
   * What to say when run() returns null, which is a capability declining rather
   * than failing. The glossary declines when no term matches; a comparison
   * declines when a player has no comparable data. Both are dead ends that
   * belong in the unsupported card with the feedback button, not answers.
   */
  readonly declineMessage: string;
  /** Runtime parameter validation. A parse failure is unsupported, not a 500. */
  parse(raw: unknown): { ok: true; params: TParams } | { ok: false; error: string };
  run(params: TParams, ctx: BeamContext): Promise<TResult | null>;
  present(result: TResult, params: TParams, ctx: BeamContext): BeamAnswer;
}

/** Type-erased handle, so the registry can hold capabilities of mixed shapes. */
export type AnyBeamCapability = BeamCapability<never, never>;

/* ------------------------------------------------------------------ */
/* What the route returns                                              */
/* ------------------------------------------------------------------ */

export type BeamOutcome =
  | {
      kind: "answer";
      answer: BeamAnswer;
      capability: CapabilityId;
      confidence: number;
      /** Set when the answer hinged on a name we matched rather than were given. */
      matchedPlayers: BeamMatchedPlayer[];
      queryId: string | null;
    }
  | { kind: "clarify"; clarification: BeamClarification; queryId: string | null }
  | {
      kind: "unsupported";
      reason: BeamUnsupportedReason;
      message: string;
      /** Example questions BEAM does handle, so the dead end has an exit. */
      suggestions: string[];
      /** Where to go instead. Set when another tool answers this question. */
      links: BeamLink[];
      queryId: string | null;
    };

/**
 * "Matched: Brock Purdy". Shown quietly under an answer with a way to correct
 * it, which turns a wrong-player answer from a trust failure into one click.
 */
export type BeamMatchedPlayer = {
  playerId: string;
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
  /** What the reader actually typed. */
  matchedOn: string;
  /** Resolver tier, for the admin debug view. */
  tier: string;
  confidence: number;
};
