/**
 * Where defenders go in real drafts, for the IDP guide's lesson 7.
 *
 * Read from player_market_latest, which the nightly Sleeper market sync
 * (lib/sync-sleeper-market.ts, cron /api/cron/sync-sleeper-market) fills from
 * Sleeper's season projections feed for every position, defenders included.
 * Two of Sleeper's ADP keys are for IDP drafts:
 *
 *   idp      superflex IDP drafts (the twelfth quarterback goes near pick 42,
 *            the same place as Sleeper's 2QB figure)
 *   idp_1qb  one-quarterback IDP drafts (the twelfth quarterback near pick 100,
 *            the same place as the plain PPR figure)
 *
 * Sleeper does not label them; that reading was measured on 2026-09-24 and is
 * the reason the page says "superflex" and "one-quarterback".
 *
 * An ADP is an overall pick number across offense and defense, so a defender's
 * number already says where he goes in a mixed draft. Rounds are counted as
 * 12-team rounds, which is our conversion and the page says so.
 *
 * Cached for a day and tagged CACHE_TAGS.marketAdp: the sync busts the tag when
 * it writes, so the guide shows each morning's figures. A failed read throws
 * rather than caching a partial summary; the page catches it and leaves the
 * figures out.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { IDP_POSITIONS, type IdpPosition } from "./idp-scarcity";

const PAGE = 1000;

/**
 * Every label a defender can carry in players.position, folded to the three
 * the guide counts. The players sync normally writes DL, LB or DB, but a few
 * rows keep Sleeper's finer label (two "DE" rows on 2026-09-24); dropping
 * them would quietly shrink the counts. Same folding as
 * lib/on-the-clock/position-colors.ts.
 */
const DEFENDER_LABELS: Readonly<Record<string, IdpPosition>> = {
  DL: "DL",
  DE: "DL",
  DT: "DL",
  NT: "DL",
  EDGE: "DL",
  LB: "LB",
  ILB: "LB",
  OLB: "LB",
  MLB: "LB",
  DB: "DB",
  CB: "DB",
  S: "DB",
  FS: "DB",
  SS: "DB",
};

/** One of the three guide positions, or null for anyone else. */
export function foldDefenderPosition(
  position: string | null | undefined,
): IdpPosition | null {
  return DEFENDER_LABELS[(position ?? "").toUpperCase()] ?? null;
}
/** The draft size rounds are counted in. */
export const ADP_ROUND_TEAMS = 12;
/** A format needs this many priced defenders before the guide quotes it. */
export const MIN_DEFENDERS = 24;
/** Picks 1 to 60: the first five rounds of a 12-team draft. */
const FIRST_FIVE_ROUNDS = 5 * ADP_ROUND_TEAMS;

export type AdpRow = { position: string; adp: Record<string, unknown> };

export type IdpAdpFormat = {
  /** Defenders with a real ADP in this format. */
  defenders: number;
  firstRound: number;
  twelfthRound: number;
  twentyFourthRound: number;
  /** Defenders drafted at pick 60 or earlier on average. */
  inFirstFiveRounds: number;
  /** Round of the twelfth defender at each position; null below twelve. */
  twelfthByPosition: Record<IdpPosition, number | null>;
};

export type IdpAdpSummary = {
  /** When the newest row was written, ISO. Display through lib/datetime.ts. */
  asOf: string;
  oneQb: IdpAdpFormat | null;
  superflex: IdpAdpFormat | null;
};

export function roundOf(pick: number): number {
  return Math.ceil(pick / ADP_ROUND_TEAMS);
}

function pickFor(adp: Record<string, unknown>, key: string): number | null {
  const v = adp[key];
  const n = typeof v === "number" ? v : Number(v);
  // The sync strips Sleeper's 999 sentinel; this guards a hand-edited row.
  return Number.isFinite(n) && n > 0 && n < 999 ? n : null;
}

/** One format's figures from defender rows. Pure. */
export function summarizeFormat(
  rows: AdpRow[],
  key: string,
): IdpAdpFormat | null {
  const picks: Array<{ position: IdpPosition; pick: number }> = [];
  for (const row of rows) {
    if (!(IDP_POSITIONS as readonly string[]).includes(row.position)) continue;
    const pick = pickFor(row.adp, key);
    if (pick !== null)
      picks.push({ position: row.position as IdpPosition, pick });
  }
  if (picks.length < MIN_DEFENDERS) return null;
  picks.sort((a, b) => a.pick - b.pick);
  const twelfthByPosition = { DL: null, LB: null, DB: null } as Record<
    IdpPosition,
    number | null
  >;
  for (const pos of IDP_POSITIONS) {
    const at = picks.filter((p) => p.position === pos);
    twelfthByPosition[pos] = at.length >= 12 ? roundOf(at[11].pick) : null;
  }
  return {
    defenders: picks.length,
    firstRound: roundOf(picks[0].pick),
    twelfthRound: roundOf(picks[11].pick),
    twentyFourthRound: roundOf(picks[23].pick),
    inFirstFiveRounds: picks.filter((p) => p.pick <= FIRST_FIVE_ROUNDS).length,
    twelfthByPosition,
  };
}

async function loadIdpAdp(): Promise<IdpAdpSummary | null> {
  const db = createCachedReadClient();
  const rows: Array<
    AdpRow & { season: number; snapshotDate: string; updatedAt: string }
  > = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("player_market_latest")
      .select("season, snapshot_date, adp, updated_at, players!inner(position)")
      .eq("source", "sleeper")
      .eq("season_type", "regular")
      .in("players.position", Object.keys(DEFENDER_LABELS))
      .order("sleeper_player_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(
        `IDP guide: player_market_latest read failed: ${error.message}`,
      );
    if (!data) break;
    for (const r of data) {
      const player = (Array.isArray(r.players) ? r.players[0] : r.players) as {
        position: string | null;
      } | null;
      rows.push({
        season: Number(r.season),
        position: foldDefenderPosition(player?.position) ?? "",
        snapshotDate: String(r.snapshot_date),
        adp: (r.adp ?? {}) as Record<string, unknown>,
        updatedAt: String(r.updated_at),
      });
    }
    if (data.length < PAGE) break;
  }
  if (rows.length === 0) return null;

  // The newest nightly run only. The latest table keeps a player's row after
  // Sleeper stops listing him, so without this a defender who dropped out in
  // October would still be counted at his September draft position, and a row
  // from last season would be counted against this season's draft.
  const season = Math.max(...rows.map((r) => r.season));
  const inSeason = rows.filter((r) => r.season === season);
  const newest = inSeason.reduce(
    (max, r) => (r.snapshotDate > max ? r.snapshotDate : max),
    inSeason[0].snapshotDate,
  );
  const current = inSeason.filter((r) => r.snapshotDate === newest);
  const asOf = current.reduce(
    (max, r) => (r.updatedAt > max ? r.updatedAt : max),
    current[0].updatedAt,
  );
  const oneQb = summarizeFormat(current, "idp_1qb");
  const superflex = summarizeFormat(current, "idp");
  if (!oneQb && !superflex) return null;
  return { asOf, oneQb, superflex };
}

export function loadIdpAdpCached(): Promise<IdpAdpSummary | null> {
  return unstable_cache(loadIdpAdp, ["idp-guide-adp", "v2"], {
    revalidate: CACHE_TTL.daily,
    tags: [CACHE_TAGS.marketAdp],
  })();
}

const NOUN_PLURAL: Record<IdpPosition, string> = {
  DL: "defensive linemen",
  LB: "linebackers",
  DB: "defensive backs",
};
const NOUN_SINGULAR: Record<IdpPosition, string> = {
  DL: "defensive lineman",
  LB: "linebacker",
  DB: "defensive back",
};

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Lesson 7's sentences, built only from what the summary holds. A format we
 * could not measure is left out of the sentence rather than printed as a gap.
 * `asOfText` is the date already formatted in Eastern time by the page.
 */
export function draftRoundSentences(
  s: IdpAdpSummary,
  asOfText: string,
): { market: string; positions: string | null } {
  const parts: string[] = [];
  const measured: Array<{ name: string; f: IdpAdpFormat }> = [];
  if (s.oneQb) measured.push({ name: "one-quarterback", f: s.oneQb });
  if (s.superflex) measured.push({ name: "superflex", f: s.superflex });
  const count = (n: number) =>
    n === 0
      ? "no defenders go"
      : n === 1
        ? "1 defender goes"
        : `${n} defenders go`;
  const early = measured.every((m) => m.f.inFirstFiveRounds === 0)
    ? `no defender goes in the first five rounds of ${list(measured.map((m) => m.name)).replace(" and ", " or ")} IDP drafts`
    : list(
        measured.map(
          (m) =>
            `${count(m.f.inFirstFiveRounds)} in the first five rounds of ${m.name} IDP drafts`,
        ),
      );
  parts.push(`As of ${asOfText}, counted in 12-team rounds, ${early}.`);
  if (s.oneQb) {
    parts.push(
      `In one-quarterback IDP drafts the first defender goes in round ${s.oneQb.firstRound}, the twelfth by round ${s.oneQb.twelfthRound} and the twenty-fourth by round ${s.oneQb.twentyFourthRound}.`,
    );
  }
  if (s.superflex) {
    parts.push(
      s.oneQb
        ? `In superflex IDP drafts, where quarterbacks go earlier, the same three marks come in rounds ${s.superflex.firstRound}, ${s.superflex.twelfthRound} and ${s.superflex.twentyFourthRound}.`
        : `In superflex IDP drafts the first defender goes in round ${s.superflex.firstRound}, the twelfth by round ${s.superflex.twelfthRound} and the twenty-fourth by round ${s.superflex.twentyFourthRound}.`,
    );
  }

  // The position sentence reads one format: one-quarterback when we have it.
  const basis = s.oneQb ?? s.superflex;
  const basisName = s.oneQb ? "one-quarterback" : "superflex";
  let positions: string | null = null;
  if (basis) {
    const ranked = IDP_POSITIONS.filter(
      (p) => basis.twelfthByPosition[p] !== null,
    ).sort(
      (a, b) =>
        (basis.twelfthByPosition[a] as number) -
        (basis.twelfthByPosition[b] as number),
    );
    if (ranked.length >= 2) {
      const first = ranked[0];
      const tie =
        basis.twelfthByPosition[ranked[1]] === basis.twelfthByPosition[first];
      const lead = tie
        ? ""
        : `${NOUN_PLURAL[first].charAt(0).toUpperCase()}${NOUN_PLURAL[first].slice(1)} come off the board first as a group. `;
      positions = `${lead}In the ${basisName} figures ${list(
        ranked.map(
          (p) =>
            `the twelfth ${NOUN_SINGULAR[p]} goes in round ${basis.twelfthByPosition[p]}`,
        ),
      )}.`;
    }
  }
  return { market: parts.join(" "), positions };
}
