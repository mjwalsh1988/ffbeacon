// Canonical NFL team list for Signal favorites. The `code` set MUST stay in
// lockstep with the signals.favorite_team CHECK (migration 0059): these are the
// 32 current franchises. Stored on signals.favorite_team; rendered as a labeled
// chip on the public profile. FF Beacon-native naming: a plain code + display
// pair, never a source-specific id.

export type NflTeam = { code: string; name: string };

export const NFL_TEAMS: NflTeam[] = [
  { code: "ARI", name: "Arizona Cardinals" },
  { code: "ATL", name: "Atlanta Falcons" },
  { code: "BAL", name: "Baltimore Ravens" },
  { code: "BUF", name: "Buffalo Bills" },
  { code: "CAR", name: "Carolina Panthers" },
  { code: "CHI", name: "Chicago Bears" },
  { code: "CIN", name: "Cincinnati Bengals" },
  { code: "CLE", name: "Cleveland Browns" },
  { code: "DAL", name: "Dallas Cowboys" },
  { code: "DEN", name: "Denver Broncos" },
  { code: "DET", name: "Detroit Lions" },
  { code: "GB", name: "Green Bay Packers" },
  { code: "HOU", name: "Houston Texans" },
  { code: "IND", name: "Indianapolis Colts" },
  { code: "JAX", name: "Jacksonville Jaguars" },
  { code: "KC", name: "Kansas City Chiefs" },
  { code: "LV", name: "Las Vegas Raiders" },
  { code: "LAC", name: "Los Angeles Chargers" },
  { code: "LAR", name: "Los Angeles Rams" },
  { code: "MIA", name: "Miami Dolphins" },
  { code: "MIN", name: "Minnesota Vikings" },
  { code: "NE", name: "New England Patriots" },
  { code: "NO", name: "New Orleans Saints" },
  { code: "NYG", name: "New York Giants" },
  { code: "NYJ", name: "New York Jets" },
  { code: "PHI", name: "Philadelphia Eagles" },
  { code: "PIT", name: "Pittsburgh Steelers" },
  { code: "SEA", name: "Seattle Seahawks" },
  { code: "SF", name: "San Francisco 49ers" },
  { code: "TB", name: "Tampa Bay Buccaneers" },
  { code: "TEN", name: "Tennessee Titans" },
  { code: "WAS", name: "Washington Commanders" },
];

export const NFL_TEAM_CODES = new Set(NFL_TEAMS.map((t) => t.code));

const NFL_TEAM_NAME_BY_CODE = new Map(NFL_TEAMS.map((t) => [t.code, t.name]));

export function isNflTeamCode(code: string | null | undefined): code is string {
  return typeof code === "string" && NFL_TEAM_CODES.has(code);
}

/** Display name for a team code, or null if the code is unknown. */
export function nflTeamName(code: string | null | undefined): string | null {
  if (!code) return null;
  return NFL_TEAM_NAME_BY_CODE.get(code) ?? null;
}
