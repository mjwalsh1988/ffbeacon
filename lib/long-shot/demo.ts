/**
 * The signed-out demo's data (plan 11). Pure data, shipped in code: the demo
 * never touches today's puzzle, the search API or the database.
 *
 * Three settled facts from the 2024 regular season, which cannot change.
 * Queries run ONCE on 2026-11-08 against production through the Supabase
 * MCP and pasted here as literals:
 *
 *   RB:  sum(player_stats.rush_yd) >= 1000, season 2024, season_type regular,
 *        players.position = 'RB'
 *   TE:  player_positional_finishes, season 2024, scoring pts_ppr,
 *        position TE, finish <= 12
 *   QB:  sum(player_stats.pass_td) >= 30, season 2024, season_type regular,
 *        players.position = 'QB'
 *
 * Tiers come from lib/long-shot/tiers.ts assignTiers over each answer's 2026
 * redraft roster rate (player_roster_rates, season 2026) read the same day.
 * Decoys are real players who missed each bar (600 to 999 rushing yards; TE
 * finishes 13 to 30; 8 to 29 passing touchdowns), so the select cannot be
 * solved by elimination. Each prompt offers 30 names.
 */

import type { SearchPlayerResult } from "@/components/player-guess-combobox";
import { SEARCH_MIN_LENGTH, type Tier } from "./types";

export interface DemoPlayer {
  name: string;
  sleeperId: string;
}

export interface DemoAnswer extends DemoPlayer {
  tier: Tier;
}

export interface DemoPrompt {
  id: string;
  text: string;
  /** The position every candidate plays, shown beside a match the way the real picker shows it. */
  position: "QB" | "RB" | "WR" | "TE";
  answers: DemoAnswer[];
  candidates: DemoPlayer[];
}

const RB_ANSWERS: DemoAnswer[] = [
  { name: "Joe Mixon", sleeperId: "4018", tier: "long_shot" },
  { name: "James Conner", sleeperId: "4137", tier: "long_shot" },
  { name: "Najee Harris", sleeperId: "7528", tier: "sleeper" },
  { name: "Rico Dowdle", sleeperId: "7021", tier: "sleeper" },
  { name: "Aaron Jones Sr.", sleeperId: "4199", tier: "deep" },
  { name: "Josh Jacobs", sleeperId: "5850", tier: "deep" },
  { name: "Bijan Robinson", sleeperId: "9509", tier: "deep" },
  { name: "Tony Pollard", sleeperId: "5967", tier: "deep" },
  { name: "Saquon Barkley", sleeperId: "4866", tier: "field" },
  { name: "Derrick Henry", sleeperId: "3198", tier: "field" },
  { name: "Jonathan Taylor", sleeperId: "6813", tier: "field" },
  { name: "James Cook III", sleeperId: "8138", tier: "field" },
  { name: "Bucky Irving", sleeperId: "11584", tier: "field" },
  { name: "Kyren Williams", sleeperId: "8150", tier: "chalk" },
  { name: "Jahmyr Gibbs", sleeperId: "9221", tier: "chalk" },
  { name: "Chuba Hubbard", sleeperId: "7594", tier: "chalk" },
];

const RB_DECOYS: DemoPlayer[] = [
  { name: "Chase Brown", sleeperId: "9224" },
  { name: "D'Andre Swift", sleeperId: "6790" },
  { name: "Alvin Kamara", sleeperId: "4035" },
  { name: "De'Von Achane", sleeperId: "9226" },
  { name: "J.K. Dobbins", sleeperId: "6806" },
  { name: "Breece Hall", sleeperId: "8155" },
  { name: "Tyrone Tracy Jr.", sleeperId: "11655" },
  { name: "Rhamondre Stevenson", sleeperId: "7611" },
  { name: "Brian Robinson Jr.", sleeperId: "8154" },
  { name: "Jordan Mason", sleeperId: "8408" },
  { name: "David Montgomery", sleeperId: "5892" },
  { name: "Tank Bigsby", sleeperId: "9225" },
  { name: "Kareem Hunt", sleeperId: "4098" },
  { name: "Tyler Allgeier", sleeperId: "8132" },
];

const TE_ANSWERS: DemoAnswer[] = [
  { name: "Jonnu Smith", sleeperId: "4144", tier: "long_shot" },
  { name: "Zach Ertz", sleeperId: "1339", tier: "long_shot" },
  { name: "David Njoku", sleeperId: "4033", tier: "sleeper" },
  { name: "Pat Freiermuth", sleeperId: "7600", tier: "deep" },
  { name: "Mark Andrews", sleeperId: "5012", tier: "deep" },
  { name: "Hunter Henry", sleeperId: "3214", tier: "deep" },
  { name: "Sam LaPorta", sleeperId: "10859", tier: "field" },
  { name: "Travis Kelce", sleeperId: "1466", tier: "field" },
  { name: "Tucker Kraft", sleeperId: "9484", tier: "field" },
  { name: "George Kittle", sleeperId: "4217", tier: "chalk" },
  { name: "Brock Bowers", sleeperId: "11604", tier: "chalk" },
  { name: "Trey McBride", sleeperId: "8130", tier: "chalk" },
];

const TE_DECOYS: DemoPlayer[] = [
  { name: "Mike Gesicki", sleeperId: "4993" },
  { name: "Cade Otton", sleeperId: "8111" },
  { name: "Kyle Pitts Sr.", sleeperId: "7553" },
  { name: "Isaiah Likely", sleeperId: "8131" },
  { name: "Juwan Johnson", sleeperId: "7002" },
  { name: "Tyler Conklin", sleeperId: "5133" },
  { name: "Cole Kmet", sleeperId: "6826" },
  { name: "Dalton Schultz", sleeperId: "5001" },
  { name: "Chig Okonkwo", sleeperId: "8210" },
  { name: "Noah Gray", sleeperId: "7828" },
  { name: "Will Dissly", sleeperId: "5010" },
  { name: "Austin Hooper", sleeperId: "3202" },
  { name: "Jake Ferguson", sleeperId: "8110" },
  { name: "Taysom Hill", sleeperId: "4381" },
  { name: "Noah Fant", sleeperId: "5857" },
  { name: "Dallas Goedert", sleeperId: "5022" },
  { name: "Foster Moreau", sleeperId: "5985" },
  { name: "Dalton Kincaid", sleeperId: "10236" },
];

const QB_ANSWERS: DemoAnswer[] = [
  { name: "Baker Mayfield", sleeperId: "4892", tier: "long_shot" },
  { name: "Sam Darnold", sleeperId: "4943", tier: "sleeper" },
  { name: "Lamar Jackson", sleeperId: "4881", tier: "deep" },
  { name: "Jared Goff", sleeperId: "3163", tier: "field" },
  { name: "Joe Burrow", sleeperId: "6770", tier: "chalk" },
];

const QB_DECOYS: DemoPlayer[] = [
  { name: "Bo Nix", sleeperId: "11563" },
  { name: "Josh Allen", sleeperId: "4984" },
  { name: "Aaron Rodgers", sleeperId: "96" },
  { name: "Patrick Mahomes", sleeperId: "4046" },
  { name: "Jayden Daniels", sleeperId: "11566" },
  { name: "Jordan Love", sleeperId: "6804" },
  { name: "Justin Herbert", sleeperId: "6797" },
  { name: "Kyler Murray", sleeperId: "5849" },
  { name: "Geno Smith", sleeperId: "1373" },
  { name: "C.J. Stroud", sleeperId: "9758" },
  { name: "Matthew Stafford", sleeperId: "421" },
  { name: "Caleb Williams", sleeperId: "11560" },
  { name: "Brock Purdy", sleeperId: "8183" },
  { name: "Tua Tagovailoa", sleeperId: "6768" },
  { name: "Jalen Hurts", sleeperId: "6904" },
  { name: "Kirk Cousins", sleeperId: "1166" },
  { name: "Russell Wilson", sleeperId: "1234" },
  { name: "Drake Maye", sleeperId: "11564" },
  { name: "Derek Carr", sleeperId: "2028" },
  { name: "Bryce Young", sleeperId: "9228" },
  { name: "Jameis Winston", sleeperId: "2306" },
  { name: "Will Levis", sleeperId: "9999" },
  { name: "Joe Flacco", sleeperId: "19" },
  { name: "Cooper Rush", sleeperId: "4574" },
  { name: "Dak Prescott", sleeperId: "3294" },
];

const byName = (a: DemoPlayer, b: DemoPlayer) => a.name.localeCompare(b.name);
const toCandidate = ({ name, sleeperId }: DemoPlayer): DemoPlayer => ({ name, sleeperId });

export const DEMO_PROMPTS: DemoPrompt[] = [
  {
    id: "rb-1000",
    text: "Name a running back with 1,000 or more rushing yards in 2024.",
    position: "RB",
    answers: RB_ANSWERS,
    candidates: [...RB_ANSWERS.map(toCandidate), ...RB_DECOYS].sort(byName),
  },
  {
    id: "te-top-12",
    text: "Name a tight end who finished top 12 in PPR scoring in 2024.",
    position: "TE",
    answers: TE_ANSWERS,
    candidates: [...TE_ANSWERS.map(toCandidate), ...TE_DECOYS].sort(byName),
  },
  {
    id: "qb-30-td",
    text: "Name a quarterback who threw 30 or more touchdowns in 2024.",
    position: "QB",
    answers: QB_ANSWERS,
    candidates: [...QB_ANSWERS.map(toCandidate), ...QB_DECOYS].sort(byName),
  },
];

export function scoreDemo(prompt: DemoPrompt, sleeperId: string): Tier | null {
  return prompt.answers.find((a) => a.sleeperId === sleeperId)?.tier ?? null;
}

/** Lowercase, punctuation out, one space between words: "C.J. Stroud" and "cj stroud" meet. */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The demo's typeahead (plan 11, revised 2026-11-08): the candidate list is
 * never shown whole, because a list a reader can scroll is a list they can
 * mine instead of recall. A match appears only once the typed text reaches
 * SEARCH_MIN_LENGTH characters, and only where it begins a name, a first
 * name or a surname, the shape the real game's search takes. At most eight,
 * in the candidates' own order.
 */
export function searchDemoCandidates(prompt: DemoPrompt, query: string, limit = 8): SearchPlayerResult[] {
  const q = normalizeName(query);
  if (q.length < SEARCH_MIN_LENGTH) return [];
  return prompt.candidates
    .filter((c) => {
      const full = normalizeName(c.name);
      return full.startsWith(q) || full.split(" ").some((word) => word.startsWith(q));
    })
    .slice(0, limit)
    .map((c) => ({ id: c.sleeperId, name: c.name, position: prompt.position, team: null, sleeperId: c.sleeperId }));
}
