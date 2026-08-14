/**
 * Turn a name a person typed into exactly one player, or into a question.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: never answer for a player we are not
 * confident about. A wrong confident answer costs more trust than a hundred
 * clarifications, because a clarification is visibly BEAM being careful and a
 * wrong answer is invisibly BEAM being wrong.
 *
 * TIERS. Candidates are grouped by how they matched, and only the best tier
 * present competes. Lower tiers become alternatives, never rivals, because the
 * tier ordering already is the decision:
 *
 *   exact      search_name matches outright                          0.97
 *   alias      an editorial nickname in beam_player_aliases          0.95
 *   single     one word that is someone's first OR last name         0.88
 *   initials   first initial (or prefix) plus last name              0.88
 *   fuzzy      trigram plus a bounded edit distance                  0.50-0.90
 *
 * WHY FIRST AND LAST NAME SHARE ONE TIER AT ONE CONFIDENCE. "brock" is Kevin
 * Brock's surname and Brock Purdy's given name. Ranking surnames above given
 * names would confidently answer a Purdy question with a backup tight end.
 * Putting them in one tier at one score means the tier has five members, the
 * uniqueness test fails, and BEAM asks. "purdy" stays a single member and is
 * answered outright. Uniqueness, not cleverness, is what makes that safe.
 *
 * SCOPE. Stat and bio questions search every player we hold, including retired
 * ones: "how many yards did Derrick Henry run for in 2021" is a fair question
 * about a real season. Value, rank, and comparison questions are restricted to
 * currently-ranked players, because there is no current trade value for someone
 * who left the league. Getting this backwards is why lib/player-search.ts
 * (correct for Signal Check) is deliberately NOT reused here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BeamSettings } from "@/lib/beam/default-settings";
import { normalizeName } from "@/lib/beam/interpret/normalize";
import { damerauLevenshtein, normalizedSimilarity } from "./distance";

const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/** Only these characters can reach a PostgREST filter. Asserted, not assumed. */
const SAFE_QUERY = /^[a-z0-9 ]+$/;

export type ResolverScope = "historical" | "current";

export type MatchTier = "exact" | "alias" | "single" | "initials" | "fuzzy";

export type ResolvedPlayer = {
  id: string;
  slug: string;
  name: string;
  firstName: string;
  lastName: string;
  position: string | null;
  team: string | null;
  status: string | null;
  searchName: string;
  searchLastName: string;
  tier: MatchTier;
  confidence: number;
  /** Lower is more prominent. Null when we hold no ranking for them. */
  overallRank: number | null;
  /** Sleeper's own popularity ordering. Lower is more notable. */
  searchRank: number | null;
  /** True when a current ranking row exists, which is the relevance gate. */
  isCurrentlyRanked: boolean;
};

export type PlayerResolution =
  | { kind: "resolved"; player: ResolvedPlayer; alternatives: ResolvedPlayer[] }
  | { kind: "ambiguous"; candidates: ResolvedPlayer[] }
  /** The name resolved, but the question needs a current player and this is not one. */
  | { kind: "not-current"; player: ResolvedPlayer }
  | { kind: "not-found" };

type PlayerRow = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  full_name: string | null;
  position: string;
  team: string | null;
  status: string;
  search_name: string | null;
  search_last_name: string | null;
  search_rank?: unknown;
};

const PLAYER_SELECT =
  "id, slug, first_name, last_name, full_name, position, team, status, search_name, search_last_name, search_rank:metadata->sleeper->search_rank";

type Candidate = {
  row: PlayerRow;
  tier: MatchTier;
  confidence: number;
};

/** Tier confidences. Single and initials are equal on purpose (see header). */
const TIER_CONFIDENCE: Record<Exclude<MatchTier, "fuzzy">, number> = {
  exact: 0.97,
  alias: 0.95,
  single: 0.88,
  initials: 0.88,
};

const TIER_ORDER: MatchTier[] = ["exact", "alias", "single", "initials", "fuzzy"];

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Options resolution needs beyond the raw name. Position and team come from the
 * question itself ("wr lamb", "the jets receiver") and are used as a filter only
 * when at least one candidate satisfies them: a wrong hint should narrow nothing
 * rather than empty the list.
 */
export type ResolvePlayerOptions = {
  scope: ResolverScope;
  settings: BeamSettings;
  /** From the question itself: "wr lamb". Highest-priority hint. */
  positionHint?: string | null;
  /**
   * From the statistic being asked about: "throw for" means a quarterback.
   * Applied after positionHint and only when it leaves candidates behind, so a
   * receiver's genuine passing yards still resolve.
   */
  statPositionHint?: readonly string[] | null;
  teamHint?: string | null;
  /** Resolved format, for the ranking read that doubles as the relevance gate. */
  formatConfigId: string | null;
  sourceSlug: string | null;
};

export async function resolvePlayer(
  db: SupabaseClient<Database>,
  rawName: string,
  opts: ResolvePlayerOptions,
): Promise<PlayerResolution> {
  const query = normalizeName(rawName);
  if (query.length < 2 || !SAFE_QUERY.test(query)) return { kind: "not-found" };

  const tokens = query.split(" ");
  const lastToken = tokens[tokens.length - 1];
  const { settings } = opts;

  /* ---- wave 1: three independent lookups ---------------------------- */

  const [directRows, aliasRows, fuzzyRows] = await Promise.all([
    lookupDirect(db, query, tokens, lastToken),
    lookupAliases(db, query),
    lookupFuzzy(db, query, settings),
  ]);

  const candidates = new Map<string, Candidate>();
  const consider = (row: PlayerRow, tier: MatchTier, confidence: number) => {
    const existing = candidates.get(row.id);
    // A player found by two routes keeps the stronger one.
    if (existing && rank(existing.tier) <= rank(tier) && existing.confidence >= confidence) {
      return;
    }
    candidates.set(row.id, { row, tier, confidence });
  };

  // Tier 2: exact normalized full name.
  for (const row of directRows) {
    if (row.search_name === query) consider(row, "exact", TIER_CONFIDENCE.exact);
  }

  // Tier 2, still exact: the same name with the internal spacing disagreed on.
  // "Amon-Ra St. Brown" stores as "amonra st brown", and a reader typing
  // "amon ra st brown" has spelled it correctly by every measure a person would
  // use. Comparing with the spaces taken out makes hyphens, apostrophes, and
  // periods stop mattering ("ja marr chase", "de von achane"), which is the
  // whole promise of the resolver rather than a special case for one player.
  const compressedQuery = compress(query);
  for (const row of [...directRows, ...fuzzyRows.map((f) => f.row)]) {
    if (compress(row.search_name ?? "") === compressedQuery) {
      consider(row, "exact", TIER_CONFIDENCE.exact);
    }
  }

  // Tier 3: editorial alias.
  for (const row of aliasRows) {
    consider(row, "alias", TIER_CONFIDENCE.alias);
  }

  // Tier 4: a single word that is someone's first or last name.
  if (tokens.length === 1) {
    for (const row of directRows) {
      if (row.search_last_name === query) consider(row, "single", TIER_CONFIDENCE.single);
      else if ((row.search_name ?? "").startsWith(`${query} `)) {
        consider(row, "single", TIER_CONFIDENCE.single);
      }
    }
  }

  // Tier 5: first initial (or a first-name prefix) plus the last name.
  if (tokens.length === 2) {
    const [firstPart] = tokens;
    for (const row of directRows) {
      if (row.search_last_name !== lastToken) continue;
      const first = normalizeName(row.first_name);
      if (!first) continue;
      const isInitial = firstPart.length === 1 && first.startsWith(firstPart);
      const isPrefix = firstPart.length >= 2 && first.startsWith(firstPart);
      if (isInitial || isPrefix) consider(row, "initials", TIER_CONFIDENCE.initials);
    }
  }

  // Tier 6: fuzzy. Gated hard on the last name, because trigram similarity over
  // a full name is dominated by whichever half matched and will happily rank
  // "Brock Bowers" against "brock prudy" on the strength of "brock" alone.
  const fuzzyAccepted: Array<{ row: PlayerRow; confidence: number; lastDistance: number }> = [];
  for (const { row, similarity } of fuzzyRows) {
    if (candidates.has(row.id)) continue;
    const candidateLast = row.search_last_name ?? "";
    // Measured against the whole surname AND each of its words, because a
    // surname is not always one word. "St. Brown" stores as "st brown", which is
    // three edits away from "brown" and so failed this gate outright, taking
    // every Amon-Ra question with it. Comparing per word keeps the gate doing
    // its real job (rejecting matches that only agree on the FIRST name) while
    // letting "brown" match the "brown" in "st brown".
    const lastDistance = Math.min(
      ...[candidateLast, ...candidateLast.split(" ")]
        .filter((part) => part.length > 0)
        .map((part) => damerauLevenshtein(lastToken, part, settings.resolver.maxEditDistance)),
    );
    if (lastDistance > settings.resolver.maxEditDistance) continue;

    const editSimilarity = normalizedSimilarity(query, row.search_name ?? "");
    const blended = 0.6 * similarity + 0.4 * editSimilarity;
    const floor = settings.resolver.trigramFloor;
    const scaled = floor >= 1 ? 0 : Math.min(1, Math.max(0, (blended - floor) / (1 - floor)));
    const confidence = 0.5 + 0.4 * scaled;
    fuzzyAccepted.push({ row, confidence, lastDistance });
  }

  // One near-miss and nothing else is not really ambiguous. A single surviving
  // candidate whose surname is one edit away is the person, and making the
  // reader confirm "brock prudy -> Brock Purdy" teaches them BEAM is fussy
  // rather than careful. Two survivors, or two edits, still asks.
  const onlyFuzzy = candidates.size === 0 && fuzzyAccepted.length === 1;
  for (const entry of fuzzyAccepted) {
    const boosted =
      onlyFuzzy && entry.lastDistance <= 1
        ? Math.max(entry.confidence, settings.resolver.acceptConfidence + 0.03)
        : entry.confidence;
    consider(entry.row, "fuzzy", boosted);
  }

  if (candidates.size === 0) return { kind: "not-found" };

  /* ---- wave 2: prominence and the relevance gate --------------------- */

  const ids = [...candidates.keys()];

  // The ranking read is skipped when it cannot change the answer.
  //
  // It feeds exactly two things: `isCurrentlyRanked`, which only a "current"
  // scope question consults, and `overallRank`, which only breaks ties between
  // candidates in the same tier. A historical-scope question whose best tier
  // has one member needs neither, and that is the shape of the most common
  // question BEAM gets. Skipping it removes a whole serialized round trip from
  // the hot path; prominence falls back to Sleeper's search_rank, which is
  // already on the row we fetched.
  const bestTierBeforeRanking = TIER_ORDER.find((t) =>
    [...candidates.values()].some((c) => c.tier === t),
  );
  const contendersInBestTier = [...candidates.values()].filter(
    (c) => c.tier === bestTierBeforeRanking,
  ).length;
  const needsRanking = opts.scope === "current" || contendersInBestTier > 1;

  const ranked = needsRanking
    ? await loadRankings(db, ids, opts.formatConfigId, opts.sourceSlug)
    : new Map<string, number>();

  let resolved: ResolvedPlayer[] = [...candidates.values()].map(({ row, tier, confidence }) => ({
    id: row.id,
    slug: row.slug,
    name: row.full_name ?? `${row.first_name} ${row.last_name}`.trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position ?? null,
    team: row.team ?? null,
    status: row.status ?? null,
    searchName: row.search_name ?? "",
    searchLastName: row.search_last_name ?? "",
    tier,
    confidence,
    overallRank: ranked.get(row.id) ?? null,
    searchRank: numOrNull(row.search_rank),
    isCurrentlyRanked: ranked.has(row.id),
  }));

  // Hints narrow, but only when they leave something behind. Order matters: the
  // reader's own words ("wr lamb") outrank an inference from the statistic, and
  // both outrank nothing.
  resolved = applyHint(resolved, (p) => p.position === opts.positionHint, opts.positionHint);
  const statPositions = opts.statPositionHint;
  if (statPositions && statPositions.length > 0) {
    resolved = applyHint(
      resolved,
      (p) => p.position !== null && statPositions.includes(p.position),
      "stat",
    );
  }
  resolved = applyHint(resolved, (p) => p.team === opts.teamHint, opts.teamHint);

  /* ---- pick the tier, then decide ------------------------------------ */

  const bestTier = TIER_ORDER.find((t) => resolved.some((p) => p.tier === t));
  if (!bestTier) return { kind: "not-found" };

  const inTier = resolved
    .filter((p) => p.tier === bestTier)
    .sort((a, b) => b.confidence - a.confidence || prominence(a) - prominence(b));
  const others = resolved
    .filter((p) => p.tier !== bestTier)
    .sort((a, b) => prominence(a) - prominence(b));

  const top = inTier[0];
  const runnerUp = inTier[1];

  const clearlyAhead =
    !runnerUp || top.confidence - runnerUp.confidence >= settings.resolver.acceptMargin;

  if (top.confidence >= settings.resolver.acceptConfidence && clearlyAhead) {
    if (opts.scope === "current" && !top.isCurrentlyRanked) {
      return { kind: "not-current", player: top };
    }
    return { kind: "resolved", player: top, alternatives: [...inTier.slice(1), ...others] };
  }

  // Not sure enough. Offer the plausible ones, best tier first.
  const pool = [...inTier, ...others].filter(
    (p) => p.confidence >= settings.resolver.clarifyFloor,
  );
  const cutoff = top.confidence - settings.resolver.clarifyWindow;
  const withinWindow = pool.filter((p) => p.confidence >= cutoff);
  const candidatesToOffer = (withinWindow.length > 0 ? withinWindow : pool).slice(
    0,
    settings.resolver.maxClarifyOptions,
  );

  if (candidatesToOffer.length === 0) return { kind: "not-found" };
  if (candidatesToOffer.length === 1) {
    const only = candidatesToOffer[0];
    if (opts.scope === "current" && !only.isCurrentlyRanked) {
      return { kind: "not-current", player: only };
    }
    // A lone candidate that still did not clear the bar is offered as a
    // confirmation rather than asserted.
    return { kind: "ambiguous", candidates: candidatesToOffer };
  }
  return { kind: "ambiguous", candidates: candidatesToOffer };
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Exact name, exact surname, and surname-of-a-two-word-query in one round trip.
 *
 * The or() filter is built from `query`, which normalizeName() has already
 * reduced to [a-z0-9 ] and SAFE_QUERY has re-checked. That matters: commas and
 * parentheses are PostgREST filter syntax, and this is the only place in BEAM
 * where user-derived text reaches a filter string at all.
 */
async function lookupDirect(
  db: SupabaseClient<Database>,
  query: string,
  tokens: string[],
  lastToken: string,
): Promise<PlayerRow[]> {
  const parts = [`search_name.eq.${query}`, `search_last_name.eq.${lastToken}`];
  if (tokens.length === 1) {
    // Given-name matches: "brock" should surface Brock Purdy, not only Kevin
    // Brock. The trailing space keeps it to a whole first word.
    parts.push(`search_name.like.${query} *`);
  }

  // Ordered, and capped well above the largest real surname bucket.
  //
  // An unordered LIMIT was a genuine hazard here, not a theoretical one: 81
  // fantasy-position players share the surname "williams", 69 share "johnson",
  // 51 share "smith". With a cap of 60 and no ORDER BY, Postgres was free to
  // return any subset, and if the exactly-matching row happened to be among the
  // dropped ones the exact tier silently never fired. The initials tier would
  // then match a DIFFERENT Williams, and if that one was unique in its tier
  // BEAM answered confidently about the wrong player.
  //
  // search_name ascending is deterministic, so the same question always gets
  // the same candidate set, which also makes the behaviour reproducible in a
  // bug report.
  const { data, error } = await db
    .from("players")
    .select(PLAYER_SELECT)
    .in("position", FANTASY_POSITIONS as unknown as string[])
    .or(parts.join(","))
    .order("search_name", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[beam] direct player lookup failed", error);
    return [];
  }
  return (data ?? []) as unknown as PlayerRow[];
}

async function lookupAliases(
  db: SupabaseClient<Database>,
  query: string,
): Promise<PlayerRow[]> {
  const { data, error } = await db
    .from("beam_player_aliases")
    .select(`player_id, players!inner(${PLAYER_SELECT})`)
    .eq("alias", query)
    .eq("is_active", true)
    .limit(10);

  if (error) {
    console.error("[beam] alias lookup failed", error);
    return [];
  }
  const rows: PlayerRow[] = [];
  for (const entry of (data ?? []) as unknown as Array<{ players: PlayerRow | null }>) {
    if (entry.players) rows.push(entry.players);
  }
  return rows;
}

async function lookupFuzzy(
  db: SupabaseClient<Database>,
  query: string,
  settings: BeamSettings,
): Promise<Array<{ row: PlayerRow; similarity: number }>> {
  const { data, error } = await db.rpc("beam_search_players" as never, {
    p_query: query,
    p_limit: 12,
    p_min_similarity: settings.resolver.trigramFloor,
  } as never);

  if (error) {
    // A fuzzy miss is a degraded answer, not a failed one: the exact tiers may
    // still have produced a match, so this never throws.
    console.error("[beam] fuzzy player lookup failed", error);
    return [];
  }

  type RpcRow = PlayerRow & { match_similarity: number | null };
  return ((data ?? []) as unknown as RpcRow[]).map((row) => ({
    row,
    similarity: typeof row.match_similarity === "number" ? row.match_similarity : 0,
  }));
}

/**
 * Current overall rank per candidate, which doubles as the relevance gate: a
 * player with no row here is not currently ranked by the active source, and that
 * is exactly what "not a current player" means for a value question.
 */
async function loadRankings(
  db: SupabaseClient<Database>,
  ids: string[],
  formatConfigId: string | null,
  sourceSlug: string | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0 || !formatConfigId || !sourceSlug) return out;

  const { data, error } = await db
    .from("rankings")
    .select("player_id, overall_rank, generated_at")
    .eq("format_config_id", formatConfigId)
    .eq("source", sourceSlug)
    .is("week", null)
    .in("player_id", ids)
    .order("generated_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[beam] ranking read failed", error);
    return out;
  }
  for (const row of data ?? []) {
    // Newest first, so the first row seen per player is the current one.
    if (out.has(row.player_id)) continue;
    if (typeof row.overall_rank === "number") out.set(row.player_id, row.overall_rank);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

function rank(tier: MatchTier): number {
  return TIER_ORDER.indexOf(tier);
}

/**
 * A name with its internal spacing removed, for comparing two spellings of the
 * same name. normalizeName has already dropped hyphens, apostrophes and periods;
 * what it cannot know is whether the person who wrote "Amon-Ra" meant one word or
 * two. This makes that question stop mattering.
 */
function compress(name: string): string {
  return name.replace(/ /g, "");
}

/**
 * Lower is more prominent. Our own current ranking is the best signal we have;
 * Sleeper's search_rank (already on the player row, so it costs no query) is the
 * fallback for anyone we do not rank, which is every retired player.
 */
function prominence(player: ResolvedPlayer): number {
  if (player.overallRank !== null) return player.overallRank;
  if (player.searchRank !== null) return 10_000 + player.searchRank;
  return 1_000_000;
}

function applyHint(
  players: ResolvedPlayer[],
  predicate: (p: ResolvedPlayer) => boolean,
  hint: string | null | undefined,
): ResolvedPlayer[] {
  if (!hint) return players;
  const narrowed = players.filter(predicate);
  // A hint that matches nothing is more likely to be our misreading of the
  // question than the reader being wrong about their own player.
  return narrowed.length > 0 ? narrowed : players;
}

/**
 * Resolve straight from a slug. This is what a clarification click comes back
 * as, and it is the only path that reaches full confidence, because the reader
 * picked from a list we showed them.
 */
export async function resolvePlayerBySlug(
  db: SupabaseClient<Database>,
  slug: string,
  opts: Pick<ResolvePlayerOptions, "formatConfigId" | "sourceSlug">,
): Promise<ResolvedPlayer | null> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;

  const { data, error } = await db
    .from("players")
    .select(PLAYER_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as PlayerRow;
  const ranked = await loadRankings(db, [row.id], opts.formatConfigId, opts.sourceSlug);

  return {
    id: row.id,
    slug: row.slug,
    name: row.full_name ?? `${row.first_name} ${row.last_name}`.trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position ?? null,
    team: row.team ?? null,
    status: row.status ?? null,
    searchName: row.search_name ?? "",
    searchLastName: row.search_last_name ?? "",
    tier: "exact",
    confidence: 1,
    overallRank: ranked.get(row.id) ?? null,
    searchRank: numOrNull(row.search_rank),
    isCurrentlyRanked: ranked.has(row.id),
  };
}
