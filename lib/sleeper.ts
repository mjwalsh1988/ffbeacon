const BASE = "https://api.sleeper.app/v1";

const headers = { "user-agent": "ffbeacon/1.0" };

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export type SleeperUser = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
};

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  total_rosters: number;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
  settings?: Record<string, number>;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  settings?: Record<string, number>;
};

export async function getSleeperUser(username: string): Promise<SleeperUser | null> {
  return safeFetch<SleeperUser>(`${BASE}/user/${encodeURIComponent(username)}`);
}

export async function getSleeperLeagues(
  userId: string,
  season: string,
): Promise<SleeperLeague[]> {
  return (await safeFetch<SleeperLeague[]>(`${BASE}/user/${userId}/leagues/nfl/${season}`)) ?? [];
}

export async function getSleeperRosters(leagueId: string): Promise<SleeperRoster[]> {
  return (await safeFetch<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`)) ?? [];
}

export async function getSleeperLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  return (await safeFetch<SleeperUser[]>(`${BASE}/league/${leagueId}/users`)) ?? [];
}

export function currentNflSeason(): string {
  const now = new Date();
  // NFL season "year" rolls over March-ish. If we're past March, this year is the season.
  const year = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  return String(year);
}
