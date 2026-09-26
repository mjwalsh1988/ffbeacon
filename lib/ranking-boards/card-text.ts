/**
 * The pure, client-safe half of Beacon Ranker's card data: the shapes, age
 * arithmetic, which finishes column a format reads, and the sentence a card's
 * accessible name carries. lib/ranking-boards/card.ts is the server loader.
 */

export type CardFinish = { season: number; finish: number };

export type CardPlayer = {
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
  /** Whole years, or null when the birth date is unknown. */
  age: number | null;
  /** Newest first, at most three, completed seasons only. */
  finishes: CardFinish[];
  /** True for a player in his first NFL season. */
  rookie: boolean;
};

/** The finishes column that matches a format's scoring type. */
export function finishScoringFor(scoringType: string | null | undefined): string {
  if (scoringType === "half_ppr") return "pts_half_ppr";
  if (scoringType === "standard") return "pts_std";
  return "pts_ppr";
}

/** Whole years between a birth date and `now`. Pure. */
export function ageOn(birthDate: string | null, now: Date): number | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const m = now.getUTCMonth() - born.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 15 && age <= 60 ? age : null;
}

/** "WR12, WR24, WR15" for an accessible name, or the rookie and no-finish
 * wording. Pure and client-safe. */
export function finishesSentence(player: Pick<CardPlayer, "position" | "finishes" | "rookie">): string {
  if (player.finishes.length === 0) {
    return player.rookie ? "rookie, no NFL finishes" : "no finishes in the last three seasons";
  }
  return `finished ${player.finishes.map((f) => `${player.position}${f.finish} in ${f.season}`).join(", ")}`;
}
