/**
 * The Long Shot history pool sync, from the nflverse data releases (CC BY
 * 4.0). Plan: docs/completed/long-shot/long-shot-plan.md section 31.3.
 *
 * Two callers, one function:
 * - the monthly cron (/api/cron/long-shot-history) syncs the current and the
 *   previous season, so rookies join the pool during the season and a
 *   finished season settles without anyone remembering anything;
 * - the script (npm run sync:nfl-history) ran the full 1920 load once and
 *   remains for a rebuild.
 *
 * Reads, in order:
 *   1. players.csv: the league's player master (1999 on, some earlier), for
 *      ids, birth dates, colleges and draft slots.
 *   2. roster_<season>.csv for every season from `fromSeason`: who was on
 *      which team at which position each year.
 *   3. draft_picks.csv (1980 on): round, pick, team, Hall of Fame, Pro Bowl
 *      and All-Pro counts.
 *   4. stats_player_week_<season>.csv from max(1999, fromSeason), aggregated
 *      to one row per player per season (sums, maxes, PPR points, positional
 *      PPR finish).
 *   5. Wikidata, one SPARQL query, for Hall of Fame PLAYERS the draft file
 *      cannot see (inducted before 1980). A failed request leaves the draft
 *      flags as they are and says so.
 *
 * One person is one history_players row, keyed `gsis:<id>` when a season row
 * carries a league id and `name:<normalized name>|<birth date>` before ids
 * existed; a name-keyed person from the 1980s is merged into the id-keyed
 * person of the same name and birth date. Linking to our players table is by
 * Sleeper id first, then name plus birth date.
 *
 * Only the seasons read are upserted, so every career-wide column is then
 * recomputed in the database (long_shot_history_recompute, migration 0371)
 * and prominence recomputed here for everyone touched. Idempotent: every
 * write upserts on its natural key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { normalizeSearchName } from "./answers";
import { parseCsv, num } from "./csv";
import { franchiseFor } from "./franchises";
import { prominenceOf } from "./prominence";

type Client = SupabaseClient<Database>;

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
/**
 * Weekly player stats moved to the `stats_player` release in 2025 (1999 to
 * the current season); the older `player_stats` release stops at 2024 and is
 * the fallback for a season the new one lacks.
 */
const STATS_RELEASES = ["stats_player", "player_stats"];
export const ROSTER_FLOOR = 1920;
const STATS_FLOOR = 1999;
const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const UPSERT_CHUNK = 500;
const PAGE = 1000;

export interface SyncOptions {
  /** Oldest season to read; ROSTER_FLOOR for the full load. */
  fromSeason: number;
  /** Rosters, draft and Hall of Fame only; stored stats stand. */
  skipStats?: boolean;
  /** Read and report, write nothing. */
  dryRun?: boolean;
  log?: (line: string) => void;
  now?: Date;
}

export interface SyncSummary {
  fromSeason: number;
  toSeason: number;
  rosterRows: number;
  people: number;
  skillPeople: number;
  linked: number;
  hallOfFamers: number;
  draftMatched: number;
  wikidata: string;
  seasonRows: number;
  statRows: number;
  recomputed: number;
  prominenceUpdated: number;
  /** Team codes outside the 32 franchises, with the decade: defunct teams. */
  defunctCodes: string[];
}

/** nflverse publishes a season's roster from March; before March the prior season is the latest. */
export function currentHistorySeason(now = new Date()): number {
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** The monthly cron's window: the current season and the one before it. */
export function incrementalFromSeason(now = new Date()): number {
  return currentHistorySeason(now) - 1;
}

async function fetchCsv(url: string): Promise<Record<string, string>[] | null> {
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts || !/fetch failed|socket|ETIMEDOUT|ECONNRESET|timeout|50[34]/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (i - 1), 8000)));
    }
  }
  throw last instanceof Error ? last : new Error(`${label}: retries exhausted`);
}

interface Person {
  key: string;
  gsis: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  positions: Map<string, number>;
  masterPosition: string | null;
  seasons: Set<number>;
  franchises: string[];
  pfr: string | null;
  sleeper: string | null;
  college: string | null;
  draft: { year: number; round: number; pick: number; team: string } | null;
  hof: boolean;
  proBowls: number;
  allPro: number;
  headshot: string | null;
  master: Record<string, string> | null;
  seasonRows: Array<{ season: number; team: string; position: string | null; raw: Record<string, string> }>;
  stats: Map<number, SeasonStat>;
}

interface SeasonStat {
  season: number;
  position: string | null;
  team: string | null;
  games: number;
  pass_yd: number;
  pass_td: number;
  rush_yd: number;
  rush_td: number;
  rec: number;
  rec_yd: number;
  rec_td: number;
  ppr_points: number;
  max_pass_yd: number;
  max_pass_td: number;
  max_rush_yd: number;
  max_rush_td: number;
  max_rec: number;
  max_rec_yd: number;
  max_rec_td: number;
  ppr_finish: number | null;
}

function nameBirthKey(name: string, birth: string | null): string {
  return `${normalizeSearchName(name)}|${birth ?? ""}`;
}

function bump(map: Map<string, number>, k: string) {
  map.set(k, (map.get(k) ?? 0) + 1);
}

export async function syncNflHistory(admin: Client, opts: SyncOptions): Promise<SyncSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const toSeason = currentHistorySeason(now);
  const fromSeason = Math.max(ROSTER_FLOOR, opts.fromSeason);
  const statsFrom = Math.max(STATS_FLOOR, fromSeason);
  log(`nflverse history sync: rosters ${fromSeason} to ${toSeason}, stats ${statsFrom} on${opts.dryRun ? " (dry run)" : ""}`);

  const people = new Map<string, Person>();
  const byNameBirth = new Map<string, Person>();

  function newPerson(key: string, name: string, birth: string | null): Person {
    const p: Person = {
      key,
      gsis: key.startsWith("gsis:") ? key.slice(5) : null,
      fullName: name,
      firstName: null,
      lastName: null,
      birthDate: birth,
      positions: new Map(),
      masterPosition: null,
      seasons: new Set(),
      franchises: [],
      pfr: null,
      sleeper: null,
      college: null,
      draft: null,
      hof: false,
      proBowls: 0,
      allPro: 0,
      headshot: null,
      master: null,
      seasonRows: [],
      stats: new Map(),
    };
    people.set(key, p);
    return p;
  }

  function personFor(gsis: string, name: string, birth: string | null, headshot: string | null): Person {
    if (gsis) {
      const key = `gsis:${gsis}`;
      const existing = people.get(key);
      if (existing) return existing;
      // A name-keyed person from an earlier season is the same human.
      const twin = birth ? byNameBirth.get(nameBirthKey(name, birth)) : null;
      if (twin && !twin.gsis) {
        people.delete(twin.key);
        twin.key = key;
        twin.gsis = gsis;
        people.set(key, twin);
        return twin;
      }
      const p = newPerson(key, name, birth);
      if (birth) byNameBirth.set(nameBirthKey(name, birth), p);
      return p;
    }
    // No league id: name plus birth date, or the NFL image id when the birth date is missing too.
    const nb = birth ? nameBirthKey(name, birth) : null;
    if (nb) {
      const existing = byNameBirth.get(nb);
      if (existing) return existing;
    }
    const key = nb ? `name:${nb}` : `image:${headshot?.split("/").pop() ?? normalizeSearchName(name)}`;
    const existing = people.get(key);
    if (existing) return existing;
    const p = newPerson(key, name, birth);
    if (nb) byNameBirth.set(nb, p);
    return p;
  }

  // 1. Player master.
  const master = (await fetchCsv(`${BASE}/players/players.csv`)) ?? [];
  const masterByGsis = new Map(master.filter((r) => r.gsis_id).map((r) => [r.gsis_id, r]));
  log(`players.csv: ${master.length} rows`);

  function applyMaster(p: Person) {
    const m = p.gsis ? masterByGsis.get(p.gsis) : undefined;
    if (!m) return;
    p.master = m;
    if (m.position) p.masterPosition = m.position;
    if (!p.birthDate && m.birth_date) p.birthDate = m.birth_date;
    if (m.college_name) p.college = m.college_name;
    if (m.pfr_id) p.pfr = m.pfr_id;
    if (m.draft_year && m.draft_round) {
      p.draft = { year: num(m.draft_year), round: num(m.draft_round), pick: num(m.draft_pick), team: m.draft_team };
    }
  }

  // 2. Rosters.
  let rosterRows = 0;
  const unknownCodes = new Map<string, number>();
  for (let s = fromSeason; s <= toSeason; s++) {
    const rows = await fetchCsv(`${BASE}/rosters/roster_${s}.csv`);
    if (!rows) {
      log(`  roster_${s}.csv: not published`);
      continue;
    }
    rosterRows += rows.length;
    for (const r of rows) {
      const name = r.full_name || `${r.first_name} ${r.last_name}`.trim();
      if (!name) continue;
      const p = personFor(r.gsis_id, name, r.birth_date || null, r.headshot_url || null);
      p.seasons.add(s);
      if (r.position) bump(p.positions, r.position);
      if (!p.firstName && r.first_name) p.firstName = r.first_name;
      if (!p.lastName && r.last_name) p.lastName = r.last_name;
      if (!p.birthDate && r.birth_date) p.birthDate = r.birth_date;
      if (!p.headshot && r.headshot_url) p.headshot = r.headshot_url;
      if (r.sleeper_id) p.sleeper = r.sleeper_id;
      if (r.pfr_id) p.pfr = r.pfr_id;
      if (r.college) p.college = r.college;
      const franchise = franchiseFor(r.team, s);
      if (!franchise) bump(unknownCodes, `${r.team}:${Math.floor(s / 10) * 10}s`);
      else if (!p.franchises.includes(franchise.key)) p.franchises.push(franchise.key);
      const compact: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) if (v !== "" && k !== "headshot_url") compact[k] = v;
      p.seasonRows.push({ season: s, team: r.team, position: r.position || null, raw: compact });
    }
    if (s % 10 === 0) log(`  rosters through ${s}: ${people.size} people`);
  }
  log(`rosters: ${rosterRows} rows, ${people.size} people`);
  const defunctCodes = Array.from(unknownCodes.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`);
  if (defunctCodes.length > 0) log(`team codes outside the 32 franchises (franchise_key null): ${defunctCodes.slice(0, 40).join(" ")}`);

  for (const p of people.values()) applyMaster(p);

  // 3. Draft picks.
  const picks = (await fetchCsv(`${BASE}/draft_picks/draft_picks.csv`)) ?? [];
  const byPfr = new Map<string, Person>();
  for (const p of people.values()) if (p.pfr) byPfr.set(p.pfr, p);
  const byNorm = new Map<string, Person[]>();
  for (const p of people.values()) {
    const k = normalizeSearchName(p.fullName);
    const list = byNorm.get(k) ?? [];
    list.push(p);
    byNorm.set(k, list);
  }
  let draftMatched = 0;
  for (const d of picks) {
    const year = num(d.season);
    let p: Person | undefined = d.gsis_id ? people.get(`gsis:${d.gsis_id}`) : undefined;
    if (!p && d.pfr_player_id) p = byPfr.get(d.pfr_player_id);
    if (!p && d.pfr_player_name && fromSeason <= year) {
      // Name only, and only when the person's whole career is in memory, so a
      // partial run cannot hand a 2010 pick to a veteran whose first season
      // read here is 2025.
      const candidates = (byNorm.get(normalizeSearchName(d.pfr_player_name)) ?? []).filter((c) => {
        const start = Math.min(...c.seasons);
        return start >= year && start <= year + 2;
      });
      if (candidates.length === 1) p = candidates[0];
    }
    if (!p) continue;
    draftMatched++;
    p.draft = { year, round: num(d.round), pick: num(d.pick), team: d.team };
    if (d.college && !p.college) p.college = d.college;
    if (d.hof === "TRUE" || d.hof === "true") p.hof = true;
    p.proBowls = Math.max(p.proBowls, num(d.probowls));
    p.allPro = Math.max(p.allPro, num(d.allpro));
  }
  log(`draft_picks.csv: ${picks.length} picks, ${draftMatched} matched to people`);

  // 4. Weekly stats, aggregated per season.
  if (!opts.skipStats) {
    for (let s = statsFrom; s <= toSeason; s++) {
      let rows: Record<string, string>[] | null = null;
      for (const release of STATS_RELEASES) {
        rows = await fetchCsv(`${BASE}/${release}/stats_player_week_${s}.csv`);
        if (rows) break;
      }
      if (!rows) {
        log(`  stats ${s}: not published`);
        continue;
      }
      for (const r of rows) {
        if (r.season_type !== "REG" || !r.player_id || r.player_id === "0") continue;
        let p = people.get(`gsis:${r.player_id}`);
        if (!p) {
          const m = masterByGsis.get(r.player_id);
          p = personFor(r.player_id, r.player_display_name || m?.display_name || r.player_name, m?.birth_date || null, null);
          applyMaster(p);
        }
        // A stats row is a season played even when the roster file missed him.
        p.seasons.add(s);
        const st: SeasonStat = p.stats.get(s) ?? {
          season: s,
          position: r.position || null,
          team: null,
          games: 0,
          pass_yd: 0,
          pass_td: 0,
          rush_yd: 0,
          rush_td: 0,
          rec: 0,
          rec_yd: 0,
          rec_td: 0,
          ppr_points: 0,
          max_pass_yd: 0,
          max_pass_td: 0,
          max_rush_yd: 0,
          max_rush_td: 0,
          max_rec: 0,
          max_rec_yd: 0,
          max_rec_td: 0,
          ppr_finish: null,
        };
        st.team = r.team || st.team;
        st.games += 1;
        const py = num(r.passing_yards);
        const pt = num(r.passing_tds);
        const ry = num(r.rushing_yards);
        const rt = num(r.rushing_tds);
        const rc = num(r.receptions);
        const cy = num(r.receiving_yards);
        const ct = num(r.receiving_tds);
        st.pass_yd += py;
        st.pass_td += pt;
        st.rush_yd += ry;
        st.rush_td += rt;
        st.rec += rc;
        st.rec_yd += cy;
        st.rec_td += ct;
        st.ppr_points += Number(r.fantasy_points_ppr) || 0;
        st.max_pass_yd = Math.max(st.max_pass_yd, py);
        st.max_pass_td = Math.max(st.max_pass_td, pt);
        st.max_rush_yd = Math.max(st.max_rush_yd, ry);
        st.max_rush_td = Math.max(st.max_rush_td, rt);
        st.max_rec = Math.max(st.max_rec, rc);
        st.max_rec_yd = Math.max(st.max_rec_yd, cy);
        st.max_rec_td = Math.max(st.max_rec_td, ct);
        p.stats.set(s, st);
      }
      // PPR finish per position, over the whole season file, so it is complete
      // whatever the run's season window.
      const byPos = new Map<string, SeasonStat[]>();
      for (const p of people.values()) {
        const st = p.stats.get(s);
        if (!st || !st.position || !SKILL.has(st.position)) continue;
        const list = byPos.get(st.position) ?? [];
        list.push(st);
        byPos.set(st.position, list);
      }
      for (const list of byPos.values()) {
        list.sort((a, b) => b.ppr_points - a.ppr_points);
        list.forEach((st, i) => void (st.ppr_finish = i + 1));
      }
      log(`  stats ${s}: ${rows.length} rows`);
    }
  }

  // 5. Hall of Fame from Wikidata: inducted PLAYERS (occupation American
  // football player, wd:Q19204627), matched by name and birth year. A
  // candidate without a birth date never matches, and a name alone is not
  // enough when Wikidata knows the birth date: coaches, owners and nicknamed
  // inductees must not flag a same-named player.
  let wikidata = "skipped";
  try {
    const sparql = `SELECT ?personLabel ?dob WHERE { ?award rdfs:label "Pro Football Hall of Fame"@en . ?person wdt:P166 ?award . ?person wdt:P106 wd:Q19204627 . OPTIONAL { ?person wdt:P569 ?dob } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": "ffbeacon-long-shot-sync/1.0" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { results: { bindings: Array<{ personLabel?: { value: string }; dob?: { value: string } }> } };
    let flagged = 0;
    for (const b of json.results.bindings) {
      const name = b.personLabel?.value;
      if (!name) continue;
      const year = b.dob?.value?.slice(0, 4);
      const candidates = (byNorm.get(normalizeSearchName(name)) ?? []).filter(
        (c) => Boolean(c.birthDate) && (!year || c.birthDate!.startsWith(year)),
      );
      if (candidates.length === 1 && !candidates[0].hof) {
        candidates[0].hof = true;
        flagged++;
      }
    }
    wikidata = `${json.results.bindings.length} members, ${flagged} newly flagged`;
  } catch (err) {
    wikidata = `lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  log(`Wikidata Hall of Fame: ${wikidata}`);

  // Link to our players table.
  const bySleeper = new Map<string, string>();
  const byOurNameBirth = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("players")
      .select("id, full_name, birth_date, external_ids")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`players read failed: ${error.message}`);
    for (const r of data ?? []) {
      const sleeper = (r.external_ids as Record<string, unknown> | null)?.sleeper;
      if (typeof sleeper === "string") bySleeper.set(sleeper, r.id);
      if (r.full_name && r.birth_date) byOurNameBirth.set(nameBirthKey(r.full_name, r.birth_date), r.id);
    }
    if (!data || data.length < PAGE) break;
  }

  // Rows. The career-wide columns here are provisional for a partial run and
  // are recomputed in the database below.
  const playerRows = Array.from(people.values()).map((p) => {
    const seasons = Array.from(p.seasons);
    const first = Math.min(...seasons);
    const last = Math.max(...seasons);
    let position = p.masterPosition && SKILL.has(p.masterPosition) ? p.masterPosition : null;
    if (!position) {
      let best: [string, number] | null = null;
      for (const e of p.positions) if (!best || e[1] > best[1]) best = e;
      position = best?.[0] ?? p.masterPosition ?? null;
    }
    if (!position) {
      const latest = Array.from(p.stats.values()).sort((a, b) => b.season - a.season)[0];
      position = latest?.position ?? null;
    }
    const totals = { games: 0, pass_yd: 0, pass_td: 0, rush_yd: 0, rush_td: 0, rec: 0, rec_yd: 0, rec_td: 0 };
    for (const st of p.stats.values()) {
      totals.games += st.games;
      totals.pass_yd += st.pass_yd;
      totals.pass_td += st.pass_td;
      totals.rush_yd += st.rush_yd;
      totals.rush_td += st.rush_td;
      totals.rec += st.rec;
      totals.rec_yd += st.rec_yd;
      totals.rec_td += st.rec_td;
    }
    const hasStats = p.stats.size > 0;
    const linked = (p.sleeper && bySleeper.get(p.sleeper)) || byOurNameBirth.get(nameBirthKey(p.fullName, p.birthDate)) || null;
    return {
      natural_key: p.key,
      full_name: p.fullName,
      first_name: p.firstName,
      last_name: p.lastName,
      search_name: normalizeSearchName(p.fullName),
      birth_date: p.birthDate,
      position,
      first_season: first,
      last_season: last,
      seasons_played: seasons.length,
      franchise_keys: p.franchises,
      gsis_id: p.gsis,
      pfr_id: p.pfr,
      sleeper_id: p.sleeper,
      player_id: linked,
      college: p.college,
      draft_year: p.draft?.year ?? null,
      draft_round: p.draft?.round ?? null,
      draft_pick: p.draft?.pick ?? null,
      draft_team: p.draft?.team ?? null,
      hof: p.hof,
      pro_bowls: p.proBowls,
      all_pro: p.allPro,
      career_games: hasStats ? totals.games : null,
      career_pass_yd: hasStats ? totals.pass_yd : null,
      career_pass_td: hasStats ? totals.pass_td : null,
      career_rush_yd: hasStats ? totals.rush_yd : null,
      career_rush_td: hasStats ? totals.rush_td : null,
      career_rec: hasStats ? totals.rec : null,
      career_rec_yd: hasStats ? totals.rec_yd : null,
      career_rec_td: hasStats ? totals.rec_td : null,
      prominence: prominenceOf({
        hof: p.hof,
        seasonsPlayed: seasons.length,
        proBowls: p.proBowls,
        allPro: p.allPro,
        draftRound: p.draft?.round ?? null,
        careerGames: hasStats ? totals.games : seasons.length * 12,
      }),
      headshot_url: p.headshot,
      metadata: (p.master ? { players: p.master } : null) as Json | null,
      synced_at: now.toISOString(),
    };
  });
  // A partial run must not overwrite career-wide columns with partial values
  // before the recompute, and a stats-less run must not clear totals.
  const partial = fromSeason > ROSTER_FLOOR || Boolean(opts.skipStats);
  const upsertRows: Array<Record<string, unknown>> = partial
    ? playerRows.map((r) => {
        const copy: Record<string, unknown> = { ...r };
        for (const k of Object.keys(copy)) {
          if (k.startsWith("career_") || k === "prominence" || k === "first_season" || k === "last_season" || k === "seasons_played" || k === "franchise_keys") {
            delete copy[k];
          }
        }
        // A new person still needs the not-null columns.
        copy.first_season = r.first_season;
        copy.last_season = r.last_season;
        return copy;
      })
    : playerRows;
  const summary: SyncSummary = {
    fromSeason,
    toSeason,
    rosterRows,
    people: playerRows.length,
    skillPeople: playerRows.filter((r) => r.position && SKILL.has(r.position)).length,
    linked: playerRows.filter((r) => r.player_id).length,
    hallOfFamers: playerRows.filter((r) => r.hof).length,
    draftMatched,
    wikidata,
    seasonRows: 0,
    statRows: 0,
    recomputed: 0,
    prominenceUpdated: 0,
    defunctCodes,
  };
  log(`people: ${summary.people} (${summary.skillPeople} at QB, RB, WR or TE), linked to players: ${summary.linked}, Hall of Famers: ${summary.hallOfFamers}`);
  if (opts.dryRun) return summary;

  // Upsert people, then read back ids.
  for (let i = 0; i < upsertRows.length; i += UPSERT_CHUNK) {
    const chunk = upsertRows.slice(i, i + UPSERT_CHUNK);
    await withRetry(async () => {
      const { error } = await admin.from("history_players").upsert(chunk as never, { onConflict: "natural_key" });
      if (error) throw new Error(error.message);
    }, "history_players upsert");
  }
  const idByKey = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("history_players")
      .select("id, natural_key")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`history_players read failed: ${error.message}`);
    for (const r of data ?? []) idByKey.set(r.natural_key, r.id);
    if (!data || data.length < PAGE) break;
  }

  const seasonRows: Array<Record<string, unknown>> = [];
  const statRows: Array<Record<string, unknown>> = [];
  for (const p of people.values()) {
    const id = idByKey.get(p.key);
    if (!id) continue;
    const seen = new Set<string>();
    for (const r of p.seasonRows) {
      const k = `${r.season}|${r.team}`;
      if (seen.has(k)) continue;
      seen.add(k);
      seasonRows.push({
        history_player_id: id,
        season: r.season,
        team_code: r.team,
        franchise_key: franchiseFor(r.team, r.season)?.key ?? null,
        position: r.position,
        metadata: r.raw,
      });
    }
    for (const st of p.stats.values()) {
      statRows.push({
        history_player_id: id,
        season: st.season,
        position: st.position,
        team_code: st.team,
        games: st.games,
        pass_yd: st.pass_yd,
        pass_td: st.pass_td,
        rush_yd: st.rush_yd,
        rush_td: st.rush_td,
        rec: st.rec,
        rec_yd: st.rec_yd,
        rec_td: st.rec_td,
        ppr_points: Math.round(st.ppr_points * 100) / 100,
        max_pass_yd: st.max_pass_yd,
        max_pass_td: st.max_pass_td,
        max_rush_yd: st.max_rush_yd,
        max_rush_td: st.max_rush_td,
        max_rec: st.max_rec,
        max_rec_yd: st.max_rec_yd,
        max_rec_td: st.max_rec_td,
        ppr_finish: st.ppr_finish,
      });
    }
  }
  for (let i = 0; i < seasonRows.length; i += UPSERT_CHUNK) {
    const chunk = seasonRows.slice(i, i + UPSERT_CHUNK);
    await withRetry(async () => {
      const { error } = await admin
        .from("history_player_seasons")
        .upsert(chunk as never, { onConflict: "history_player_id,season,team_code" });
      if (error) throw new Error(error.message);
    }, "history_player_seasons upsert");
  }
  for (let i = 0; i < statRows.length; i += UPSERT_CHUNK) {
    const chunk = statRows.slice(i, i + UPSERT_CHUNK);
    await withRetry(async () => {
      const { error } = await admin
        .from("history_player_season_stats")
        .upsert(chunk as never, { onConflict: "history_player_id,season" });
      if (error) throw new Error(error.message);
    }, "history_player_season_stats upsert");
  }
  summary.seasonRows = seasonRows.length;
  summary.statRows = statRows.length;
  log(`history_player_seasons: ${seasonRows.length} rows; history_player_season_stats: ${statRows.length} rows`);

  // Career-wide columns from every stored row, then prominence for everyone touched.
  const since = fromSeason > ROSTER_FLOOR ? fromSeason : null;
  // p_since defaults to NULL in SQL (every season), and the generated types
  // spell an optional argument without `| null`, so a null is sent by leaving
  // the argument out.
  const { data: recomputed, error: recomputeError } = await admin.rpc(
    "long_shot_history_recompute",
    since === null ? {} : { p_since: since },
  );
  if (recomputeError) throw new Error(`history recompute failed: ${recomputeError.message}`);
  summary.recomputed = Number(recomputed ?? 0);
  summary.prominenceUpdated = await recomputeProminence(admin, since);
  log(`recomputed ${summary.recomputed} people; prominence updated for ${summary.prominenceUpdated}. Done.`);
  return summary;
}

/** Prominence for everyone whose last season is in or after `since` (all when null). */
async function recomputeProminence(admin: Client, since: number | null): Promise<number> {
  let updated = 0;
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from("history_players")
      .select("id, natural_key, full_name, search_name, first_season, last_season, seasons_played, hof, pro_bowls, all_pro, draft_round, career_games, prominence")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since !== null) q = q.gte("last_season", since);
    const { data, error } = await q;
    if (error) throw new Error(`prominence read failed: ${error.message}`);
    const changed = (data ?? [])
      .map((r) => ({
        row: r,
        next: prominenceOf({
          hof: r.hof,
          seasonsPlayed: r.seasons_played,
          proBowls: r.pro_bowls,
          allPro: r.all_pro,
          draftRound: r.draft_round,
          careerGames: r.career_games ?? r.seasons_played * 12,
        }),
      }))
      .filter((x) => Math.abs(Number(x.row.prominence) - x.next) >= 0.00005)
      .map((x) => ({
        id: x.row.id,
        natural_key: x.row.natural_key,
        full_name: x.row.full_name,
        search_name: x.row.search_name,
        first_season: x.row.first_season,
        last_season: x.row.last_season,
        prominence: x.next,
      }));
    for (let i = 0; i < changed.length; i += UPSERT_CHUNK) {
      const chunk = changed.slice(i, i + UPSERT_CHUNK);
      await withRetry(async () => {
        const { error: upsertError } = await admin.from("history_players").upsert(chunk, { onConflict: "id" });
        if (upsertError) throw new Error(upsertError.message);
      }, "prominence upsert");
    }
    updated += changed.length;
    if (!data || data.length < PAGE) break;
  }
  return updated;
}
