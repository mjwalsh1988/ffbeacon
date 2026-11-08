/**
 * Seeded randomness for puzzle generation. Pure.
 *
 * Generation is deterministic for a given (game_date, seed_salt, settings,
 * data): the cron and inline generation both use salt 0, so a race or a retry
 * for the same date reproduces the same puzzle, and an admin regenerate bumps
 * the salt to get a different draw (plan 7.1).
 */

/** mulberry32: a small, fast, well-distributed 32-bit PRNG. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed for a game date: yyyymmdd * 31 + salt. */
export function seedFor(gameDate: string, salt: number): number {
  const yyyymmdd = Number(gameDate.replaceAll("-", ""));
  return yyyymmdd * 31 + salt;
}

/** Fisher-Yates over a copy; the input is never mutated. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One element, uniformly. Throws on an empty list, which is a caller bug. */
export function pick<T>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) throw new Error("pick: empty list");
  return items[Math.floor(rng() * items.length)];
}
