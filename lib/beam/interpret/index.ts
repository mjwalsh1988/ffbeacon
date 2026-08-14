/**
 * The deterministic interpreter: raw text in, a BeamRequest out.
 *
 * This is the only component in BEAM that ever sees what a person typed, and the
 * only one an LLM would replace. Everything downstream takes validated params
 * and resolved ids, which is what makes the V2 swap a new file next to this one
 * rather than a rewrite.
 *
 * THE PIPELINE
 *   normalize -> extract entities -> score capabilities -> resolve -> build
 *
 * ORDERED FALLTHROUGH. Scoring produces a ranked list of readings, not a single
 * answer. Each is tried in order and the first that can actually be BUILT wins:
 * resolution failures are how a wrong reading eliminates itself. "What is FAAB"
 * scores as a value question about a player named Faab before it scores as a
 * definition; the value reading dies at player resolution and the definition
 * answers. Testing a reading against reality beats testing it against a
 * threshold.
 *
 * WHAT THIS FILE DOES NOT DO. It never touches player_stats, rankings, or the
 * Breakdown. It resolves names and seasons, and hands over. A capability's run()
 * is where data is read, and it is unaware that a human was involved.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  AnyBeamCapability,
  BeamClarification,
  BeamClarifyOption,
  BeamContext,
  BeamEvidence,
  BeamInterpretation,
  BeamInterpreter,
  BeamMatchedPlayer,
  BeamRequest,
  BeamUnsupportedReason,
} from "@/lib/beam/types";
import { enabledCapabilities } from "@/lib/beam/capabilities";
import {
  bareUnitCandidates,
  getStat,
  statForPosition,
  type BeamStatId,
} from "@/lib/beam/stats/registry";
import { defaultSeason } from "@/lib/beam/clock";
import {
  resolvePlayer,
  type PlayerResolution,
  type ResolvedPlayer,
} from "@/lib/beam/resolve/player";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import { positionTeam } from "@/lib/beam/answers/format";
import { extractEntities, type ExtractedEntities, type NameSpan } from "./entities";
import { seasonsForSpan, spanLabel } from "./season-span";
import { normalizeText } from "./normalize";
import { scoreCapabilities, subjectCount } from "./score";
import { looksOutOfScope, type SeasonToken } from "./lexicon";

/** How many readings to try before giving up. */
const MAX_ATTEMPTS = 4;

/**
 * How many candidate names to check against the database when a question
 * produced more of them than the capability takes. A bound, not a page: it stops
 * a rambling sentence from fanning out into a dozen lookups.
 */
const MAX_PROBE_SPANS = 4;

/**
 * Everything the route needs back, beyond the interpretation itself: what was
 * matched (for the "Matched: Brock Purdy" line) and the debug trail.
 */
export type BeamInterpretResult = {
  interpretation: BeamInterpretation;
  matchedPlayers: BeamMatchedPlayer[];
  normalized: string;
  /** Ranked readings with their score breakdown. Admin debug view only. */
  trace: Array<{ capability: string; score: number; reasons: string[] }>;
};

export class DeterministicInterpreter implements BeamInterpreter {
  readonly id = "deterministic-v1";

  async interpret(text: string, ctx: BeamContext): Promise<BeamInterpretation> {
    const full = await this.interpretVerbose(text, ctx);
    return full.interpretation;
  }

  async interpretVerbose(text: string, ctx: BeamContext): Promise<BeamInterpretResult> {
    const entities = extractEntities(text);
    // One resolution per distinct name across every reading attempted.
    //
    // Ordered fallthrough tries up to four readings, and they almost always ask
    // about the same name. Without this the same four queries ran once per
    // reading: a two-player comparison could reach 32 round trips to resolve two
    // names. The key includes the scope and the hints because those genuinely
    // change the answer.
    const resolutionCache = new Map<string, Promise<PlayerResolution>>();
    const empty: BeamInterpretResult = {
      interpretation: { kind: "unsupported", reason: "no-intent" },
      matchedPlayers: [],
      normalized: entities.normalized,
      trace: [],
    };

    if (entities.tokens.length === 0) return empty;

    const candidates = scoreCapabilities(
      enabledCapabilities(ctx.settings.capabilities.disabled),
      entities,
      ctx.settings,
    );
    const trace = candidates.map((c) => ({
      capability: c.capability.id,
      score: c.score,
      reasons: c.reasons,
    }));

    // A question about the reader's own league is not a parse failure, it is a
    // question about data BEAM cannot see. Checked before scoring so the answer
    // names the real limit and points at League Pulse, instead of reporting that
    // it could not find a player called "my team".
    //
    // Except when the reader already did the narrowing. "Who should I draft in
    // my league" needs a draft board; "who should I draft in my league, Amon-Ra
    // or James Cook" needs two players compared, which BEAM can do. Only the
    // draft-shaped phrases bend here (see OUT_OF_SCOPE_UNLESS_NARROWED): a
    // start-or-sit or a trade question still depends on the rest of a roster, so
    // naming two players does not make it answerable.
    const comparingNamedPlayers =
      subjectCount(entities) >= 2 &&
      (entities.hasComparator ||
        entities.heads.includes("who is better") ||
        entities.concepts.includes("compare-better"));
    if (looksOutOfScope(entities.normalized, { comparingNamedPlayers })) {
      return {
        ...empty,
        interpretation: { kind: "unsupported", reason: "out-of-scope" },
        trace,
      };
    }

    const viable = candidates.filter((c) => c.score >= ctx.settings.intent.acceptScore);
    if (viable.length === 0) {
      return { ...empty, trace };
    }

    // Remember the most informative failure across attempts, so a dead end
    // reports "we could not find that player" rather than a generic shrug.
    let bestFailure: BeamUnsupportedReason = "no-intent";
    let bestClarification: BeamClarification | null = null;

    const attempts = viable.slice(0, MAX_ATTEMPTS);
    for (let i = 0; i < attempts.length; i++) {
      const candidate = attempts[i];
      const attempt = await this.build(
        candidate.capability,
        candidate.score,
        entities,
        ctx,
        resolutionCache,
      );

      if (attempt.kind === "request") {
        return {
          interpretation: { kind: "request", request: attempt.request },
          matchedPlayers: attempt.matchedPlayers,
          normalized: entities.normalized,
          trace,
        };
      }
      if (attempt.kind === "clarify") {
        // A clarification from the BEST reading is the answer, not a fallback.
        // "How many yards did Gibbs have" is genuinely three questions for a
        // running back; falling through to a lower reading would answer a
        // question about his trade value instead of asking which yards.
        // Clarifications from weaker readings are kept only as a last resort.
        if (i === 0) {
          return {
            interpretation: { kind: "clarify", clarification: attempt.clarification },
            matchedPlayers: [],
            normalized: entities.normalized,
            trace,
          };
        }
        if (!bestClarification) bestClarification = attempt.clarification;
      }
      if (attempt.kind === "unsupported" && bestFailure === "no-intent") {
        bestFailure = attempt.reason;
      }
    }

    // A clarification beats an unsupported: asking one question is a better dead
    // end than declaring defeat when we nearly had it.
    if (bestClarification) {
      return {
        interpretation: { kind: "clarify", clarification: bestClarification },
        matchedPlayers: [],
        normalized: entities.normalized,
        trace,
      };
    }
    return {
      interpretation: { kind: "unsupported", reason: bestFailure },
      matchedPlayers: [],
      normalized: entities.normalized,
      trace,
    };
  }

  /* ---------------------------------------------------------------- */

  private async build(
    capability: AnyBeamCapability,
    score: number,
    entities: ExtractedEntities,
    ctx: BeamContext,
    resolutionCache: Map<string, Promise<PlayerResolution>>,
  ): Promise<
    | { kind: "request"; request: BeamRequest; matchedPlayers: BeamMatchedPlayer[] }
    | { kind: "clarify"; clarification: BeamClarification }
    | { kind: "unsupported"; reason: BeamUnsupportedReason }
  > {
    const evidence: BeamEvidence[] = [];
    for (const statId of entities.statIds) {
      evidence.push({ kind: "stat", text: getStat(statId).label, value: statId });
    }
    if (entities.lens) {
      evidence.push({ kind: "lens", text: entities.lens, value: entities.lens });
    }

    /* ---- the glossary path needs no player at all ------------------ */

    if (capability.id === "glossary.term") {
      const term = entities.nameSpans.map((s) => s.text).join(" ").trim();
      if (term.length < 2) return { kind: "unsupported", reason: "no-intent" };
      const parsed = capability.parse({ term } as never);
      if (!parsed.ok) return { kind: "unsupported", reason: "no-intent" };
      return {
        kind: "request",
        request: {
          capability: capability.id,
          params: parsed.params as Record<string, unknown>,
          confidence: score,
          evidence: [{ kind: "head", text: term, value: term }],
        },
        matchedPlayers: [],
      };
    }

    /* ---- resolve the players --------------------------------------- */

    const wanted = capability.matcher.playerCount === 2 ? 2 : 1;

    // A team defense IS a player row, named "Baltimore Ravens". But the team
    // vocabulary claims "ravens" before name spans are built, so a question
    // about a defense arrives with zero names and every capability disqualifies
    // itself. When nothing else is left to be the subject, the team becomes it.
    const teamMode = entities.nameSpans.length === 0 && entities.teams.length > 0;
    const candidateSpans = teamMode
      ? teamSpans(entities.teams, wanted)
      : entities.nameSpans;
    if (candidateSpans.length < wanted) {
      return { kind: "unsupported", reason: "no-player" };
    }

    // The statistic narrows WHO was meant. "How many yards did brock throw for"
    // has four Brocks in the six fantasy positions and exactly one quarterback,
    // and the verb already told us it is a quarterback question.
    const statPositionHint =
      entities.statIds.length > 0
        ? (getStat(entities.statIds[0]).resolutionPositions ?? null)
        : null;

    const positionHint = entities.positions[0] ?? null;
    // A synthesized team span IS the name, so the team must not also narrow it.
    const teamHint = entities.nameSpans.length === 0 ? null : (entities.teams[0] ?? null);

    const resolveSpan = (span: NameSpan) => {
      const key = [
        span.text,
        capability.playerScope,
        positionHint ?? "",
        (statPositionHint ?? []).join("/"),
        teamHint ?? "",
      ].join("|");
      let pending = resolutionCache.get(key);
      if (!pending) {
        pending = resolvePlayer(ctx.supabase, span.text, {
          scope: capability.playerScope,
          settings: ctx.settings,
          positionHint,
          statPositionHint,
          teamHint,
          formatConfigId: ctx.formatConfigId,
          sourceSlug: ctx.sourceSlug,
        });
        resolutionCache.set(key, pending);
      }
      return pending;
    };

    let spans = pickSpans(candidateSpans, wanted);

    // MORE CANDIDATE NAMES THAN THE QUESTION TAKES.
    //
    // This used to be answered by counting: three spans meant three players,
    // which meant "BEAM can handle two players at a time". But a span is only a
    // run of words nothing else claimed, so any word missing from the vocabulary
    // becomes one. "Project Tucker Kraft's season totals by using his weeks 1
    // through 5" produced three spans, two of which were "totals" and "by
    // using", and the reader was told the question had too many players in it.
    //
    // So ask the database instead of guessing. Resolve every candidate and count
    // the ones that are actually people. Three real players still declines, for
    // the original and correct reason: answering about two of three without
    // saying so is the wrong kind of helpful. This only costs a query when the
    // question has extra spans, which is exactly the case that was broken, and
    // resolutions are memoised across readings so a second attempt is free.
    if (!teamMode && candidateSpans.length > wanted) {
      const probe = pickSpans(candidateSpans, Math.min(candidateSpans.length, MAX_PROBE_SPANS));
      const probed = await Promise.all(probe.map(resolveSpan));
      const real = probe.filter((_, i) => probed[i].kind === "resolved");
      if (real.length > wanted) {
        return { kind: "unsupported", reason: "too-many-players" };
      }
      if (real.length === wanted) spans = real;
      // Fewer than wanted: keep the longest-span pick and let the loop below
      // report the real failure (not found, ambiguous, not ranked).
    }

    const resolutions = await Promise.all(spans.map(resolveSpan));

    const players: ResolvedPlayer[] = [];
    for (let i = 0; i < resolutions.length; i++) {
      const resolution = resolutions[i];
      if (resolution.kind === "resolved") {
        players.push(resolution.player);
        evidence.push({
          kind: "player",
          text: spans[i].text,
          value: resolution.player.id,
        });
        continue;
      }
      if (resolution.kind === "ambiguous") {
        return {
          kind: "clarify",
          clarification: buildPlayerClarification(entities, spans[i], resolution.candidates),
        };
      }
      if (resolution.kind === "not-current") {
        // We know exactly who they meant; he just has no live value or ranking.
        // That is a different sentence from "we could not find him".
        return { kind: "unsupported", reason: "not-ranked" };
      }
      return { kind: "unsupported", reason: "no-player" };
    }

    const matchedPlayers: BeamMatchedPlayer[] = players.map((p, i) => ({
      playerId: p.id,
      slug: p.slug,
      name: p.name,
      position: p.position,
      team: p.team,
      matchedOn: spans[i].text,
      tier: p.tier,
      confidence: p.confidence,
    }));

    const refs = players.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      position: p.position,
      team: p.team,
    }));

    /* ---- the comparison verdict path ------------------------------- */

    if (capability.id === "player.compare.verdict") {
      // When the reader did not say which kind of league, take the one they are
      // already looking at rather than a constant. Their format is resolved for
      // every request anyway, and someone browsing in Redraft PPR who asks who
      // to draft means this season, not 2029. The answer still says which lens
      // it used, because the format is an inference and inferences get stated.
      const impliedLens = ctx.isDynasty ? "dynasty" : "win-now";
      const parsed = capability.parse({
        slugA: refs[0].slug,
        slugB: refs[1].slug,
        nameA: refs[0].name,
        nameB: refs[1].name,
        lens: entities.lens ?? impliedLens,
        lensWasStated: entities.lens !== null,
      } as never);
      if (!parsed.ok) return { kind: "unsupported", reason: "no-intent" };
      return {
        kind: "request",
        request: {
          capability: capability.id,
          params: parsed.params as Record<string, unknown>,
          confidence: score,
          evidence,
        },
        matchedPlayers,
      };
    }

    /* ---- the week range, for anything that takes one ---------------- */

    const weeks = entities.weeks
      ? { start: entities.weeks.start, end: entities.weeks.end }
      : null;
    if (entities.weeks) {
      evidence.push({
        kind: "season",
        text: entities.weeks.text,
        value: `${entities.weeks.start}-${entities.weeks.end}`,
      });
    }

    /* ---- the season window, for the multi-season questions ---------- */

    // Resolved here rather than inside a capability because it depends on the
    // clock, and because the seasons a question covers belong in the request
    // log next to the question that asked for them.
    const seasonWindow = resolveSeasonWindow(entities, ctx);
    if (seasonWindow.kind === "seasons") {
      evidence.push({
        kind: "season",
        text: seasonWindow.label,
        value: seasonWindow.seasons.join(","),
      });
    }

    /* ---- the season, for anything that needs one -------------------- */

    const season = resolveSeason(entities.seasons, ctx);
    if (season) {
      evidence.push({
        kind: "season",
        text: String(season.season),
        value: String(season.season),
      });
    }

    /* ---- the stat, for anything that needs one ---------------------- */

    let statId: BeamStatId | null = entities.statIds[0] ?? null;

    // A projection with no statistic named is a question about fantasy points.
    // "Project his weeks 2 to 4 over a season" is asking what those weeks were
    // WORTH, and points are the only unit that answers that. Every other
    // capability still requires the reader to name a stat.
    if (capability.id === "player.weeks.projection" && !statId) {
      statId = "fantasy_points";
    }

    if (capability.matcher.required.includes("stat")) {
      if (!statId) return { kind: "unsupported", reason: "unsupported-stat" };

      // A bare unit that no verb disambiguated. For a running back, "yards"
      // genuinely means three different numbers, so ask rather than pick.
      if (entities.ambiguousUnit) {
        const position = players[0]?.position ?? null;
        const options = bareUnitCandidates(entities.ambiguousUnit, position);
        if (options.length > 1) {
          return {
            kind: "clarify",
            clarification: buildStatClarification(entities, options.map((s) => s.id)),
          };
        }
        if (options.length === 1) statId = options[0].id;
      }

      // Now that the player is known, a phrase that means two things can be
      // pinned down. "Interceptions" is a turnover for a quarterback and a
      // takeaway for a defense, and only the player says which.
      statId = statForPosition(statId, players[0]?.position ?? null);
    }

    /* ---- assemble --------------------------------------------------- */

    // A projection needs its week range: without one there is nothing to
    // project FROM, and defaulting to the whole season would answer a question
    // the reader did not ask.
    if (capability.matcher.required.includes("weeks") && !weeks) {
      return { kind: "unsupported", reason: "no-data" };
    }

    const raw: Record<string, unknown> =
      capability.matcher.playerCount === 2
        ? { a: refs[0], b: refs[1], statId, season, weeks, window: seasonWindow }
        : { player: refs[0], statId, season, weeks, window: seasonWindow };

    const parsed = capability.parse(raw as never);
    if (!parsed.ok) return { kind: "unsupported", reason: "no-intent" };

    return {
      kind: "request",
      request: {
        capability: capability.id,
        params: parsed.params as Record<string, unknown>,
        confidence: score,
        evidence,
      },
      matchedPlayers,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Which unclaimed spans are the players.
 *
 * Longest first when we need fewer spans than we have, because a two-word span
 * is far more likely to be a full name than a one-word fragment sitting beside
 * it. Original order is restored afterwards, so "Lamb or Wilson" stays in the
 * order the reader wrote them and the answer does not silently swap the sides.
 */
/**
 * Turn team codes into name spans matching how a team defense is stored.
 *
 * players holds a defense as "Baltimore Ravens", so search_name is
 * "baltimore ravens". NFL_TEAMS is the canonical code-to-name list the rest of
 * the site already uses, so this cannot drift from the roster.
 */
function teamSpans(codes: string[], wanted: number): NameSpan[] {
  const out: NameSpan[] = [];
  for (const code of codes.slice(0, wanted)) {
    const team = NFL_TEAMS.find((t) => t.code === code);
    if (!team) continue;
    const text = normalizeText(team.name);
    out.push({ text, start: 0, end: 0 });
  }
  return out;
}

/**
 * Which seasons a multi-season question covers.
 *
 * Measured against the newest season we hold GRADED rows for, not the calendar
 * season. In August the current season has no results in it, so "the last three
 * years" counted from the calendar would ask for a season nobody has played and
 * silently answer with two thirds of the evidence.
 */
function resolveSeasonWindow(
  entities: ExtractedEntities,
  ctx: BeamContext,
): { kind: "career" } | { kind: "seasons"; seasons: number[]; label: string } {
  const latest = ctx.clock.latestStatSeason;

  if (entities.seasonSpan) {
    const seasons = seasonsForSpan(entities.seasonSpan, latest).filter(
      (s) => s >= ctx.clock.earliestStatSeason,
    );
    if (seasons.length > 0) {
      return { kind: "seasons", seasons, label: spanLabel(entities.seasonSpan) };
    }
  }

  const explicit = entities.seasons.find((s) => s.kind === "explicit");
  if (explicit && explicit.kind === "explicit") {
    return { kind: "seasons", seasons: [explicit.season], label: String(explicit.season) };
  }

  const relative = entities.seasons.find((s) => s.kind === "relative");
  if (relative && relative.kind === "relative") {
    const season = latest + relative.offset + 1;
    if (season >= ctx.clock.earliestStatSeason && season <= latest) {
      return { kind: "seasons", seasons: [season], label: String(season) };
    }
  }

  // Nothing said. The stored all-seasons row is both the widest sample and the
  // one the rest of the site already shows.
  return { kind: "career" };
}

function pickSpans(spans: NameSpan[], wanted: number): NameSpan[] {
  if (spans.length <= wanted) return spans;
  return [...spans]
    .map((span, index) => ({ span, index, size: span.end - span.start }))
    .sort((a, b) => b.size - a.size || a.index - b.index)
    .slice(0, wanted)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.span);
}

/**
 * Turn season words into a year.
 *
 * "last year" is relative to the NFL's current season, not to the newest season
 * we hold: in August those differ, and someone saying "last year" in the
 * preseason means the season that just finished, which is exactly
 * clock.previousSeason. Saying nothing at all falls to defaultSeason(), which
 * prefers the newest season with games in it.
 */
function resolveSeason(
  tokens: SeasonToken[],
  ctx: BeamContext,
): { season: number; source: "explicit" | "relative" | "current" | "none" } | null {
  const clock = ctx.clock;
  for (const token of tokens) {
    if (token.kind === "explicit") return { season: token.season, source: "explicit" };
    if (token.kind === "relative") {
      return { season: clock.currentSeason + token.offset, source: "relative" };
    }
    if (token.kind === "current") {
      // "This year" during a season with no games yet is answered with the last
      // real season plus a caveat, rather than with an empty row.
      return { season: defaultSeason(clock), source: "current" };
    }
    // "career" and "rookie year" are not supported yet; fall through so the
    // question is answered for a season rather than refused outright.
  }
  return { season: defaultSeason(clock), source: "none" };
}

function buildPlayerClarification(
  entities: ExtractedEntities,
  span: NameSpan,
  candidates: ResolvedPlayer[],
): BeamClarification {
  const options: BeamClarifyOption[] = candidates.map((player) => {
    const detail = positionTeam(player.position, player.team) || null;
    return {
      value: player.slug,
      label: player.name,
      detail,
      speech: detail ? `${player.name}, ${expandDetail(player)}` : player.name,
    };
  });

  return {
    kind: "player",
    prompt: `More than one player matches "${span.text}". Which one did you mean?`,
    options,
    template: replaceSpan(entities, span, "{player}"),
  };
}

function buildStatClarification(
  entities: ExtractedEntities,
  statIds: BeamStatId[],
): BeamClarification {
  const options: BeamClarifyOption[] = statIds.map((id) => {
    const stat = getStat(id);
    return {
      // The phrasing, not the id: the answer is fed back in as a rewritten
      // question, so it has to be something the lexicon can match.
      value: stat.phrasings[0] ?? stat.label.toLowerCase(),
      label: stat.label,
      detail: stat.group,
      speech: `${stat.label}, a ${stat.group.toLowerCase()} statistic.`,
    };
  });
  const unit = entities.ambiguousUnit ?? "yards";
  return {
    kind: "stat",
    prompt: `Which ${unit} did you mean?`,
    options,
    template: entities.ambiguousUnitSpan
      ? replaceSpan(entities, entities.ambiguousUnitSpan, "{stat}")
      : entities.normalized,
  };
}

/** "wide receiver for the Atlanta Falcons", for the spoken option label. */
function expandDetail(player: ResolvedPlayer): string {
  const positionWord = positionNoun(player.position);
  if (positionWord && player.team) return `${positionWord} for ${player.team}`;
  if (positionWord) return positionWord;
  return player.team ?? "";
}

function positionNoun(position: string | null): string {
  switch ((position ?? "").toUpperCase()) {
    case "QB":
      return "quarterback";
    case "RB":
      return "running back";
    case "WR":
      return "wide receiver";
    case "TE":
      return "tight end";
    case "K":
      return "kicker";
    case "DEF":
      return "team defense";
    default:
      return "";
  }
}

/**
 * The original question with one span swapped for a placeholder, so answering a
 * clarification re-asks the whole question rather than starting over. A reader
 * who typed a nine-word question should not lose eight of those words to pick a
 * name from a list.
 */
function replaceSpan(
  entities: ExtractedEntities,
  span: NameSpan,
  placeholder: string,
): string {
  const tokens = [...entities.tokens];
  tokens.splice(span.start, span.end - span.start, placeholder);
  return tokens.join(" ");
}

export { normalizeText };
export const deterministicInterpreter = new DeterministicInterpreter();
