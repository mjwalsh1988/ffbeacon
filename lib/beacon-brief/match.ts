/**
 * The Beacon Brief reference matcher.
 *
 * Resolves the AI-returned category / player / team NAMES to real DB rows, but
 * only AUTO-LINKS when the match is confident and unambiguous. The rules:
 *
 *  - Category: exact active slug match (unchanged).
 *  - Teams: exact normalized abbreviation, full name, nickname, or city, tried in
 *    that order, and only when the tier that hits resolves to exactly ONE team.
 *    Reporters write "Falcons" and "Commanders" far more often than "Atlanta
 *    Falcons", so full-name-only matching sent almost every team reference to
 *    manual review. Nicknames (the last word of the name) are unique across all 32
 *    teams; cities are not ("New York", "Los Angeles"), so an ambiguous city falls
 *    through to moderation with ranked suggestions rather than guessing. Never a
 *    substring guess.
 *  - Players: exactly ONE CURRENT (active/ir) player whose normalized full_name
 *    equals the normalized AI name -> auto-link. Multiple current exacts ->
 *    disambiguate by a referenced team; if exactly one plays for a referenced
 *    team, auto-link, else moderation. No current exact -> never auto-link;
 *    moderation with the top trigram-similar candidates as ranked suggestions.
 *
 * Confident matches flow into article_players / article_teams (and Discord role
 * pings). Non-confident names become PendingReferenceMatch entries that the
 * caller turns into beacon_brief_moderation rows for manual one-click resolution.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BeaconBriefSettings } from "./settings";
import type {
  CategorizeResult,
  MatchCandidate,
  PendingReferenceMatch,
  ReferenceMatchResult,
} from "./types";

type Admin = SupabaseClient<Database>;

const GENERATIONAL_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Players we treat as "current" enough to confidently auto-link to fresh news. */
function isCurrent(status: string | null): boolean {
  return status === "active" || status === "ir";
}

/**
 * Normalize a name for equality comparison: lowercase, strip punctuation,
 * collapse whitespace, and drop a trailing generational suffix (jr/sr/ii..v).
 */
export function normalizeName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return "";
  let tokens = cleaned.split(" ");
  while (
    tokens.length > 1 &&
    GENERATIONAL_SUFFIXES.has(tokens[tokens.length - 1])
  ) {
    tokens = tokens.slice(0, -1);
  }
  return tokens.join(" ");
}

/** Dedupe AI-returned names by normalized form (so "Mahomes" and "Mahomes II"
 *  collapse to one), preserving the first spelling seen. */
function dedupeNames(names: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names ?? []) {
    const trimmed = (n ?? "").trim();
    if (!trimmed) continue;
    const key = normalizeName(trimmed) || trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function pushUnique(list: string[], id: string): void {
  if (!list.includes(id)) list.push(id);
}

// ----- Dice bigram similarity (only for ranking the 32 teams) -----

function bigrams(value: string): string[] {
  const s = normalizeName(value).replace(/\s+/g, "");
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function diceSimilarity(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.length === 0 || bb.length === 0) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap += 1;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (ba.length + bb.length);
}

type TeamRow = {
  id: string;
  abbreviation: string;
  name: string;
  discord_role_ids: string[] | null;
};

/** The last word of a team name ("Washington Commanders" -> "commanders"). */
export function teamNickname(name: string): string {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  return tokens.length > 1 ? tokens[tokens.length - 1] : "";
}

/** Everything before the nickname ("Washington Commanders" -> "washington"). */
export function teamCity(name: string): string {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  return tokens.length > 1 ? tokens.slice(0, -1).join(" ") : "";
}

function addTo(map: Map<string, TeamRow[]>, key: string, team: TeamRow): void {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(team);
  else map.set(key, [team]);
}

/**
 * Resolve one AI-written team reference to a single team, or null.
 *
 * Tiers are tried in descending confidence and the FIRST tier that produces any
 * hit decides the outcome. A tier that hits more than one team returns null
 * rather than falling through: "New York" is genuinely ambiguous, and quietly
 * dropping to a lower-confidence tier would turn a real ambiguity into a guess.
 */
export function resolveTeamReference(
  rawName: string,
  teams: TeamRow[],
): TeamRow | null {
  const norm = normalizeName(rawName);
  if (!norm) return null;

  const byExact = new Map<string, TeamRow[]>();
  const byNickname = new Map<string, TeamRow[]>();
  const byCity = new Map<string, TeamRow[]>();
  for (const t of teams) {
    addTo(byExact, normalizeName(t.abbreviation), t);
    addTo(byExact, normalizeName(t.name), t);
    addTo(byNickname, teamNickname(t.name), t);
    addTo(byCity, teamCity(t.name), t);
  }

  for (const tier of [byExact, byNickname, byCity]) {
    const hits = tier.get(norm);
    if (!hits) continue;
    return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

function rankTeams(
  rawName: string,
  teams: TeamRow[],
  limit: number,
): MatchCandidate[] {
  return teams
    .map((t) => ({
      id: t.id,
      label: `${t.name} (${t.abbreviation})`,
      score: Math.max(
        diceSimilarity(rawName, t.name),
        diceSimilarity(rawName, t.abbreviation),
      ),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map(({ id, label }) => ({ id, label }));
}

type PlayerCandidate = {
  id: string;
  full_name: string | null;
  status: string | null;
  team: string | null;
  pos: string | null;
  sim: number | null;
};

function playerLabel(c: PlayerCandidate): string {
  const meta = [c.pos, c.team].filter(Boolean).join(" - ");
  const base = c.full_name ?? "(unnamed player)";
  const withMeta = meta ? `${base} (${meta})` : base;
  return isCurrent(c.status) ? withMeta : `${withMeta} [${c.status}]`;
}

/**
 * Resolve AI-named refs to confident ids plus a list of names needing review.
 * Teams are matched first because their abbreviations disambiguate same-name
 * players.
 */
export async function matchReferences(
  admin: Admin,
  ai: CategorizeResult,
  settings: BeaconBriefSettings,
): Promise<ReferenceMatchResult> {
  const roleIds = new Set<string>();
  const pending: PendingReferenceMatch[] = [];

  // Category: exact active slug match.
  let categoryId: string | null = null;
  if (ai.category_slug) {
    const { data: cat } = await admin
      .from("news_categories")
      .select("id, discord_role_ids")
      .eq("slug", ai.category_slug)
      .eq("is_active", true)
      .maybeSingle();
    if (cat) {
      categoryId = cat.id;
      for (const r of cat.discord_role_ids ?? []) roleIds.add(r);
    }
  }

  // Teams: exact abbreviation or exact name only. Load the small table once.
  const teamIds: string[] = [];
  const matchedTeamAbbrevs = new Set<string>();
  const teamNames = dedupeNames(ai.teams);
  if (teamNames.length > 0) {
    const { data: allTeams } = await admin
      .from("nfl_teams")
      .select("id, abbreviation, name, discord_role_ids");
    const teams = (allTeams ?? []) as TeamRow[];
    for (const rawTeam of teamNames) {
      if (!normalizeName(rawTeam)) continue;
      const t = resolveTeamReference(rawTeam, teams);
      if (t) {
        pushUnique(teamIds, t.id);
        matchedTeamAbbrevs.add(t.abbreviation.toLowerCase());
        for (const r of t.discord_role_ids ?? []) roleIds.add(r);
      } else {
        pending.push({
          kind: "team",
          rawName: rawTeam,
          candidates: rankTeams(rawTeam, teams, settings.matchCandidateLimit),
        });
      }
    }
  }

  // Players: exact-normalized current match only (with team disambiguation).
  const playerIds: string[] = [];
  for (const rawPlayer of dedupeNames(ai.players)) {
    const norm = normalizeName(rawPlayer);
    if (norm.length < 2) continue;
    const queryName = rawPlayer.replace(/[(),*]/g, " ").trim() || rawPlayer;

    const { data } = await admin.rpc("bb_player_match_candidates", {
      p_name: queryName,
      p_limit: settings.matchCandidateLimit,
      p_threshold: settings.matchSimilarityThreshold,
    });
    const list = (data ?? []) as PlayerCandidate[];

    const exactCurrent = list.filter(
      (c) =>
        isCurrent(c.status) &&
        c.full_name &&
        normalizeName(c.full_name) === norm,
    );

    if (exactCurrent.length === 1) {
      pushUnique(playerIds, exactCurrent[0].id);
      continue;
    }
    if (exactCurrent.length > 1) {
      const byTeam = exactCurrent.filter(
        (c) => c.team && matchedTeamAbbrevs.has(c.team.toLowerCase()),
      );
      if (byTeam.length === 1) {
        pushUnique(playerIds, byTeam[0].id);
        continue;
      }
      pending.push({
        kind: "player",
        rawName: rawPlayer,
        candidates: exactCurrent.map((c) => ({
          id: c.id,
          label: playerLabel(c),
        })),
      });
      continue;
    }

    // No confident current exact match: never auto-link. Offer ranked suggestions.
    pending.push({
      kind: "player",
      rawName: rawPlayer,
      candidates: list.map((c) => ({ id: c.id, label: playerLabel(c) })),
    });
  }

  return { categoryId, playerIds, teamIds, roleIds: [...roleIds], pending };
}
