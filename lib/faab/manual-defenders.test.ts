import { describe, expect, it } from "vitest";
import { idp123PerGame, pickRankingSeason } from "./manual-defenders";

function season(
  playerId: string,
  year: number,
  games: number,
  line: Record<string, number>,
  games20 = games,
) {
  return {
    player_id: playerId,
    season: year,
    position: "LB",
    games,
    games_20_snaps: games20,
    ...line,
  };
}

describe("idp123PerGame", () => {
  it("scores a season line under Sleeper's default IDP scoring, per game", () => {
    // 20 solo (40) + 10 assisted (10) + 2 sacks (12) over 2 games = 31 a game.
    expect(idp123PerGame({ idp_tkl_solo: 20, idp_tkl_ast: 10, idp_sack: 2 }, 2)).toBe(31);
  });

  it("never reads a combined tackle figure on top of solo and assisted", () => {
    expect(idp123PerGame({ idp_tkl: 30, idp_tkl_solo: 20, idp_tkl_ast: 10 }, 1)).toBe(50);
  });

  it("is null with no games", () => {
    expect(idp123PerGame({ idp_tkl_solo: 5 }, 0)).toBeNull();
  });
});

describe("pickRankingSeason", () => {
  it("prefers this season once he has two games, and last season before that", () => {
    const rows = [
      season("a", 2026, 2, { idp_tkl_solo: 10 }),
      season("a", 2025, 17, { idp_tkl_solo: 17 }),
      season("b", 2026, 1, { idp_tkl_solo: 8 }),
      season("b", 2025, 17, { idp_tkl_solo: 34 }),
    ];
    const picked = pickRankingSeason(rows, 2026);
    expect(picked.get("a")).toMatchObject({ season: 2026, pointsPerGame: 10 });
    expect(picked.get("b")).toMatchObject({ season: 2025, pointsPerGame: 4 });
  });

  it("leaves out a player who never played a real defensive role", () => {
    const picked = pickRankingSeason([season("c", 2026, 3, { idp_tkl_solo: 3 }, 0)], 2026);
    expect(picked.has("c")).toBe(false);
  });

  it("falls back to this season's small sample when there is no prior season", () => {
    const picked = pickRankingSeason([season("d", 2026, 1, { idp_tkl_solo: 5 })], 2026);
    expect(picked.get("d")).toMatchObject({ season: 2026, pointsPerGame: 10 });
  });
});
