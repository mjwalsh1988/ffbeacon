/**
 * Bookmarked trades.
 *
 * "Not interested" used to be the only verb Trade Finder had, and it was doing
 * two jobs: recording an opinion, and being the Next button. Navigation now
 * moves through the shortlist on its own, which leaves room for the other thing
 * a person wants to do with a deal they like, which is keep it and go and offer
 * it later.
 *
 * A BOOKMARK IS A SNAPSHOT, NOT A REFERENCE
 *   A pass stores only the engine's fingerprint, because it only has to answer
 *   "have I seen this". A bookmark has to answer "what was it", and the engine
 *   cannot be asked again: rosters move, values move nightly, and the package
 *   that balanced on Tuesday may not be constructible on Friday. So the whole
 *   suggestion is stored and a saved trade renders from that, never recomputed.
 *   Same contract a frozen Signal Check permalink holds.
 *
 * WHY THE CLIENT IS ALLOWED TO POST THE SNAPSHOT
 *   The alternative is to post a fingerprint and re-run the whole search to find
 *   the deal it names, which is roughly two and a half seconds of database work
 *   to record a bookmark. The row is only ever read back by the person who wrote
 *   it, so the worst a forged one can do is show its author a trade they made
 *   up: the same reasoning migration 0173 makes for a forged pass. The schema
 *   below is bounded hard, and that is what stops the column becoming general
 *   storage. It is not there to prove the engine produced the deal.
 *
 * READS AND WRITES THROUGH THE READER'S OWN SESSION CLIENT, like the pass list.
 * The owner policies on trade_suggestion_saves are what scope these rows, rather
 * than a `user_id` filter we remembered to write.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { isValidSuggestionKey } from "@/lib/trade-finder/fingerprint";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { TradeSuggestion } from "@/lib/trade-finder/types";

type SessionClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * How many trades one reader may keep.
 *
 * Far past what anyone will bookmark by hand, and low enough that a script
 * hammering the save action cannot grow the table without bound. Enforced by a
 * count before insert, which can race: two saves landing together can leave a
 * reader on 101. That is an acceptable overshoot for a bookmark, and the honest
 * alternative is a service-definer RPC doing the count and the insert in one
 * statement, which is more machinery than a ceiling this soft deserves.
 */
const MAX_SAVES_PER_USER = 100;

/** Assets per side. The engine's own ceiling is three; six is slack, not licence. */
const MAX_ASSETS_PER_SIDE = 6;
const MAX_TEXT = 400;
const MAX_PITCH = 2000;

/**
 * Finite AND of a plausible magnitude.
 *
 * `.finite()` alone rejects NaN and Infinity, which it has to, because JSON
 * round-trips both to null and the column would end up holding a null where a
 * number is declared. It still admits 1e308, and since the client posts the
 * snapshot wholesale a forged bookmark could render its own author an asset
 * worth a googol. Bounded here instead: trade values live in the low thousands
 * on every source we carry, so a million is slack rather than licence.
 */
const finiteNumber = z.number().finite().min(-1e6).max(1e6);
/** Nobody has ever been 200. Ages arrive from Sleeper as a decimal year. */
const ageNumber = z.number().finite().min(0).max(60);

/**
 * Version-agnostic on purpose.
 *
 * Zod's own `.uuid()` enforces the RFC-4122 version and variant bits. Every
 * players.id today comes from gen_random_uuid() and is a v4, so it would pass,
 * but a player id is an opaque display identifier here and rejecting a bookmark
 * over a version nibble would be a strange way to fail. This mirrors the pattern
 * the finder's own actions already validate ids with.
 */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const suggestionAssetSchema = z.union([
  z
    .object({
      kind: z.literal("player"),
      playerId: uuidLike,
      sleeperId: z.string().max(64).nullable(),
      name: z.string().max(120),
      position: z.string().max(12),
      team: z.string().max(12).nullable(),
      value: finiteNumber,
      age: ageNumber.nullable(),
      projPoints: finiteNumber.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pick"),
      key: z.string().max(80),
      label: z.string().max(80),
      season: z.number().int().min(2000).max(2100),
      round: z.number().int().min(1).max(10),
      value: finiteNumber,
    })
    .strict(),
]);

const sideImpactSchema = z
  .object({
    valueDelta: finiteNumber,
    lineupDelta: finiteNumber.nullable(),
    ageDelta: finiteNumber.nullable(),
    pickCountDelta: finiteNumber,
  })
  .strict();

/**
 * The suggestion as the client was shown it.
 *
 * `.strict()` throughout: an unknown key is a rejection, not something to ignore,
 * so the column cannot be used to carry a payload past this file.
 */
export const savedSuggestionSchema = z
  .object({
    key: z.string().refine(isValidSuggestionKey, "not a suggestion fingerprint"),
    counterparty: z
      .object({
        rosterId: z.number().int().min(0).max(100000),
        teamName: z.string().max(120),
        ownerHandle: z.string().max(120).nullable(),
        statusLabel: z.string().max(60).nullable(),
        direction: z.enum(["win-now", "balanced", "rebuild"]),
      })
      .strict(),
    incoming: z.array(suggestionAssetSchema).min(1).max(MAX_ASSETS_PER_SIDE),
    outgoing: z.array(suggestionAssetSchema).min(1).max(MAX_ASSETS_PER_SIDE),
    mine: sideImpactSchema,
    theirs: sideImpactSchema,
    valueGap: finiteNumber,
    qualityRatio: finiteNumber,
    acceptance: z.enum(["likely", "worth-asking", "long-shot"]),
    score: finiteNumber,
    headline: z.string().max(MAX_TEXT),
    /**
     * Optional, and it has to stay that way.
     *
     * Every bookmark written before this field existed is a stored object
     * without it, and the schema runs on the way OUT as well as on the way in.
     * Requiring it would not fail loudly, it would make those rows silently
     * vanish from the reader's Saved tab, which is the worst possible way for a
     * new field to land. Absent means an older snapshot, and the card handles
     * that by showing nothing rather than an empty heading.
     */
    rationale: z.string().max(MAX_TEXT).optional(),
    whyYou: z.string().max(MAX_TEXT),
    whyThem: z.string().max(MAX_TEXT),
    pitch: z.string().max(MAX_PITCH),
    caveats: z.array(z.string().max(MAX_TEXT)).max(8),
  })
  .strict();

export const savedGradeSchema = z
  .object({
    verdictLabel: z.string().max(MAX_TEXT),
    favours: z.enum(["you", "them", "neither"]),
    confidenceLabel: z.string().max(60).nullable(),
    tradeShapeLabel: z.string().max(60).nullable(),
    explanation: z.string().max(MAX_PITCH),
    formatDisplay: z.string().max(80),
  })
  .strict();

export type SavedTrade = {
  suggestionKey: string;
  sleeperLeagueId: string;
  leagueName: string | null;
  suggestion: TradeSuggestion;
  grade: SuggestionGrade | null;
  savedAtIso: string;
};

/** This reader's bookmarks, newest first. Never throws. */
export async function loadSavedTrades(supabase: SessionClient): Promise<SavedTrade[]> {
  try {
    const { data } = await supabase
      .from("trade_suggestion_saves")
      .select("sleeper_league_id, suggestion_key, league_name, snapshot, grade, saved_at")
      .order("saved_at", { ascending: false })
      .limit(MAX_SAVES_PER_USER);

    const out: SavedTrade[] = [];
    for (const row of data ?? []) {
      // Parsed on the way OUT as well as on the way in. A row written by an
      // older shape of the engine should drop out of the list rather than
      // render as a half a card, and the cost is one validation per bookmark.
      const parsed = savedSuggestionSchema.safeParse(row.snapshot);
      if (!parsed.success) continue;
      const grade = row.grade ? savedGradeSchema.safeParse(row.grade) : null;
      out.push({
        suggestionKey: row.suggestion_key,
        sleeperLeagueId: row.sleeper_league_id,
        leagueName: row.league_name,
        // `rationale` is optional in the stored shape and required on the type,
        // so it is filled here rather than papered over by the cast. A bookmark
        // written before the field existed renders without the block, which is
        // what the card's own guard expects.
        suggestion: {
          ...parsed.data,
          rationale: parsed.data.rationale ?? "",
        } as TradeSuggestion,
        grade: grade?.success ? (grade.data as SuggestionGrade) : null,
        savedAtIso: row.saved_at,
      });
    }
    return out;
  } catch {
    // A failed read means an empty Saved tab, which is a worse experience rather
    // than a broken one, and it beats an error page over a bookmark list.
    return [];
  }
}

/** Just the keys, for marking the Save button on the shortlist. Never throws. */
export async function loadSavedKeys(supabase: SessionClient): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("trade_suggestion_saves")
      .select("suggestion_key")
      .limit(MAX_SAVES_PER_USER);
    return (data ?? []).map((row) => row.suggestion_key);
  } catch {
    return [];
  }
}

export type SaveResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Store a bookmark, or refresh one that already exists.
 *
 * The upsert targets the unique index rather than checking first, so two presses
 * landing together settle in the database instead of racing in this process.
 *
 * `user_id` is stamped from the caller's own session, never from the request.
 * The insert policy would reject any other value anyway, which is the belt to
 * this braces.
 */
export async function saveTrade(
  supabase: SessionClient,
  params: {
    userId: string;
    sleeperLeagueId: string;
    leagueName: string | null;
    suggestion: unknown;
    grade: unknown;
  },
): Promise<SaveResult> {
  const parsed = savedSuggestionSchema.safeParse(params.suggestion);
  if (!parsed.success) return { ok: false, error: "That trade could not be saved." };

  const gradeParsed =
    params.grade == null ? null : savedGradeSchema.safeParse(params.grade);
  const grade = gradeParsed?.success ? gradeParsed.data : null;

  const { count } = await supabase
    .from("trade_suggestion_saves")
    .select("id", { count: "exact", head: true });
  if (typeof count === "number" && count >= MAX_SAVES_PER_USER) {
    // Named rather than silent. A save that quietly did nothing is the exact
    // failure this whole change set out to remove from the other buttons.
    const { data: existing } = await supabase
      .from("trade_suggestion_saves")
      .select("id")
      .eq("sleeper_league_id", params.sleeperLeagueId)
      .eq("suggestion_key", parsed.data.key)
      .maybeSingle();
    if (!existing) {
      return {
        ok: false,
        error: `You have ${MAX_SAVES_PER_USER} saved trades, which is the limit. Remove one to save another.`,
      };
    }
  }

  const { error } = await supabase.from("trade_suggestion_saves").upsert(
    {
      user_id: params.userId,
      sleeper_league_id: params.sleeperLeagueId,
      suggestion_key: parsed.data.key,
      league_name: params.leagueName,
      snapshot: parsed.data as unknown as Json,
      grade: (grade ?? null) as unknown as Json,
      saved_at: new Date().toISOString(),
    },
    { onConflict: "user_id,sleeper_league_id,suggestion_key" },
  );
  return error ? { ok: false, error: "That trade could not be saved." } : { ok: true };
}

/** Remove a bookmark. Scoped by the owner policies, not by a filter here. */
export async function removeSavedTrade(
  supabase: SessionClient,
  params: { sleeperLeagueId: string; suggestionKey: string },
): Promise<boolean> {
  if (!isValidSuggestionKey(params.suggestionKey)) return false;
  const { error } = await supabase
    .from("trade_suggestion_saves")
    .delete()
    .eq("sleeper_league_id", params.sleeperLeagueId)
    .eq("suggestion_key", params.suggestionKey);
  return !error;
}

export const SAVE_LIMITS = { MAX_SAVES_PER_USER, MAX_ASSETS_PER_SIDE };
