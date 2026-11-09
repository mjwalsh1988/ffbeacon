/**
 * The 32 modern franchises and the team codes the nflverse season rosters
 * use for each of them through the years. Pure.
 *
 * A code is read WITH its season: BAL before 1984 is the Colts and from 1996
 * the Ravens; STL is the Cardinals through 1987 and the Rams from 1995; BOS is
 * the Redskins in the 1930s and the Patriots in the 1960s. A code that maps to
 * nothing is a defunct team (Akron Pros, Dayton Triangles) and its season rows
 * keep a null franchise_key.
 */

export interface Franchise {
  key: string;
  /** The modern code in lib/nfl-teams.ts. */
  code: string;
  name: string;
  /** Plain name for a prompt: "the Raiders". */
  short: string;
  /** First NFL (or AFL) season. */
  since: number;
  spans: Array<{ code: string; from: number; to: number | null }>;
}

const OPEN = null;

export const FRANCHISES: readonly Franchise[] = [
  { key: "cardinals", code: "ARI", name: "Arizona Cardinals", short: "Cardinals", since: 1920, spans: [{ code: "CHC", from: 1920, to: 1959 }, { code: "CRD", from: 1920, to: 1959 }, { code: "STL", from: 1960, to: 1987 }, { code: "PHO", from: 1988, to: 1993 }, { code: "PHX", from: 1988, to: 1993 }, { code: "ARI", from: 1994, to: OPEN }, { code: "ARZ", from: 1994, to: OPEN }] },
  { key: "falcons", code: "ATL", name: "Atlanta Falcons", short: "Falcons", since: 1966, spans: [{ code: "ATL", from: 1966, to: OPEN }] },
  { key: "ravens", code: "BAL", name: "Baltimore Ravens", short: "Ravens", since: 1996, spans: [{ code: "BAL", from: 1996, to: OPEN }, { code: "BLT", from: 1996, to: OPEN }] },
  { key: "bills", code: "BUF", name: "Buffalo Bills", short: "Bills", since: 1960, spans: [{ code: "BUF", from: 1960, to: OPEN }] },
  { key: "panthers", code: "CAR", name: "Carolina Panthers", short: "Panthers", since: 1995, spans: [{ code: "CAR", from: 1995, to: OPEN }] },
  { key: "bears", code: "CHI", name: "Chicago Bears", short: "Bears", since: 1920, spans: [{ code: "DEC", from: 1920, to: 1920 }, { code: "CHB", from: 1921, to: OPEN }, { code: "CHI", from: 1921, to: OPEN }] },
  { key: "bengals", code: "CIN", name: "Cincinnati Bengals", short: "Bengals", since: 1968, spans: [{ code: "CIN", from: 1968, to: OPEN }] },
  { key: "browns", code: "CLE", name: "Cleveland Browns", short: "Browns", since: 1950, spans: [{ code: "CLE", from: 1946, to: OPEN }, { code: "CLV", from: 1946, to: OPEN }] },
  { key: "cowboys", code: "DAL", name: "Dallas Cowboys", short: "Cowboys", since: 1960, spans: [{ code: "DAL", from: 1960, to: OPEN }, { code: "COW", from: 1960, to: 1962 }] },
  { key: "broncos", code: "DEN", name: "Denver Broncos", short: "Broncos", since: 1960, spans: [{ code: "DEN", from: 1960, to: OPEN }] },
  { key: "lions", code: "DET", name: "Detroit Lions", short: "Lions", since: 1930, spans: [{ code: "POR", from: 1930, to: 1933 }, { code: "DET", from: 1934, to: OPEN }] },
  { key: "packers", code: "GB", name: "Green Bay Packers", short: "Packers", since: 1921, spans: [{ code: "GB", from: 1921, to: OPEN }, { code: "GNB", from: 1921, to: OPEN }] },
  { key: "texans", code: "HOU", name: "Houston Texans", short: "Texans", since: 2002, spans: [{ code: "HOU", from: 2002, to: OPEN }, { code: "HST", from: 2002, to: OPEN }] },
  { key: "colts", code: "IND", name: "Indianapolis Colts", short: "Colts", since: 1953, spans: [{ code: "BAL", from: 1953, to: 1983 }, { code: "IND", from: 1984, to: OPEN }] },
  { key: "jaguars", code: "JAX", name: "Jacksonville Jaguars", short: "Jaguars", since: 1995, spans: [{ code: "JAX", from: 1995, to: OPEN }, { code: "JAC", from: 1995, to: OPEN }] },
  { key: "chiefs", code: "KC", name: "Kansas City Chiefs", short: "Chiefs", since: 1960, spans: [{ code: "DTX", from: 1960, to: 1962 }, { code: "TEX", from: 1960, to: 1962 }, { code: "KC", from: 1963, to: OPEN }, { code: "KAN", from: 1963, to: OPEN }] },
  { key: "raiders", code: "LV", name: "Las Vegas Raiders", short: "Raiders", since: 1960, spans: [{ code: "OAK", from: 1960, to: 2019 }, { code: "RAI", from: 1960, to: 2019 }, { code: "LV", from: 2020, to: OPEN }, { code: "LVR", from: 2020, to: OPEN }] },
  { key: "chargers", code: "LAC", name: "Los Angeles Chargers", short: "Chargers", since: 1960, spans: [{ code: "SD", from: 1960, to: 2016 }, { code: "SDG", from: 1960, to: 2016 }, { code: "LAC", from: 1960, to: OPEN }] },
  { key: "rams", code: "LAR", name: "Los Angeles Rams", short: "Rams", since: 1937, spans: [{ code: "CLE", from: 1937, to: 1945 }, { code: "LA", from: 1946, to: 1981 }, { code: "RAM", from: 1946, to: 1994 }, { code: "STL", from: 1995, to: 2015 }, { code: "SL", from: 1995, to: 2015 }, { code: "LA", from: 2016, to: OPEN }, { code: "LAR", from: 1946, to: OPEN }] },
  { key: "dolphins", code: "MIA", name: "Miami Dolphins", short: "Dolphins", since: 1966, spans: [{ code: "MIA", from: 1966, to: OPEN }] },
  { key: "vikings", code: "MIN", name: "Minnesota Vikings", short: "Vikings", since: 1961, spans: [{ code: "MIN", from: 1961, to: OPEN }] },
  { key: "patriots", code: "NE", name: "New England Patriots", short: "Patriots", since: 1960, spans: [{ code: "BOS", from: 1960, to: 1970 }, { code: "NE", from: 1960, to: OPEN }, { code: "NWE", from: 1960, to: OPEN }] },
  { key: "saints", code: "NO", name: "New Orleans Saints", short: "Saints", since: 1967, spans: [{ code: "NO", from: 1967, to: OPEN }, { code: "NOR", from: 1967, to: OPEN }] },
  { key: "giants", code: "NYG", name: "New York Giants", short: "Giants", since: 1925, spans: [{ code: "NY", from: 1925, to: 1969 }, { code: "NYG", from: 1925, to: OPEN }] },
  { key: "jets", code: "NYJ", name: "New York Jets", short: "Jets", since: 1960, spans: [{ code: "NYT", from: 1960, to: 1962 }, { code: "NYJ", from: 1960, to: OPEN }] },
  { key: "eagles", code: "PHI", name: "Philadelphia Eagles", short: "Eagles", since: 1933, spans: [{ code: "PHI", from: 1933, to: OPEN }] },
  { key: "steelers", code: "PIT", name: "Pittsburgh Steelers", short: "Steelers", since: 1933, spans: [{ code: "PIT", from: 1933, to: OPEN }] },
  { key: "seahawks", code: "SEA", name: "Seattle Seahawks", short: "Seahawks", since: 1976, spans: [{ code: "SEA", from: 1976, to: OPEN }] },
  { key: "49ers", code: "SF", name: "San Francisco 49ers", short: "49ers", since: 1950, spans: [{ code: "SF", from: 1946, to: OPEN }, { code: "SFO", from: 1946, to: OPEN }] },
  { key: "buccaneers", code: "TB", name: "Tampa Bay Buccaneers", short: "Buccaneers", since: 1976, spans: [{ code: "TB", from: 1976, to: OPEN }, { code: "TAM", from: 1976, to: OPEN }] },
  { key: "titans", code: "TEN", name: "Tennessee Titans", short: "Titans", since: 1960, spans: [{ code: "HOU", from: 1960, to: 1996 }, { code: "OTI", from: 1960, to: 1996 }, { code: "TEN", from: 1997, to: OPEN }] },
  { key: "commanders", code: "WAS", name: "Washington Commanders", short: "Commanders", since: 1932, spans: [{ code: "BOS", from: 1932, to: 1936 }, { code: "WAS", from: 1937, to: OPEN }] },
];

const BY_KEY = new Map(FRANCHISES.map((f) => [f.key, f]));

export function franchiseByKey(key: string): Franchise | null {
  return BY_KEY.get(key) ?? null;
}

/** The modern franchise a roster team code belongs to in a season, or null for a defunct team. */
export function franchiseFor(code: string, season: number): Franchise | null {
  const c = code.toUpperCase();
  for (const f of FRANCHISES) {
    for (const s of f.spans) {
      if (s.code === c && season >= s.from && (s.to === null || season <= s.to)) return f;
    }
  }
  return null;
}

/**
 * A present-day code read without a season (the nflverse players master
 * writes a 1985 Rams draft as "LA" and a 1985 Raiders draft as "LV"). The
 * era-aware read comes first wherever a season is known; this is the fallback.
 */
export function franchiseForModernCode(code: string): Franchise | null {
  const c = code.toUpperCase();
  if (c === "LA") return BY_KEY.get("rams") ?? null;
  return FRANCHISES.find((f) => f.code === c || f.spans.some((s) => s.code === c && s.to === null)) ?? null;
}
