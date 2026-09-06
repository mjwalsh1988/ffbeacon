/**
 * Which NFL season "now" belongs to.
 *
 * This lives apart from `lib/sleeper.ts` for one reason: it is the only thing
 * in that file a CLIENT component ever wanted. Since the Sleeper call budget
 * landed (`lib/sleeper-budget.ts`, MPS-T032), importing `lib/sleeper.ts` drags
 * `node:async_hooks` in behind it, which webpack cannot put in a browser
 * bundle, so a client component that only needed a date calculation could no
 * longer have one. A pure module with no imports at all can be read from
 * either side.
 *
 * `lib/sleeper.ts` re-exports it, so every existing server-side import keeps
 * working and there is still exactly ONE copy of the rollover rule. That
 * matters: there used to be two, one using local time and one using UTC, which
 * disagreed for a few hours twice a year (finding F14).
 */

/**
 * The season year as a string, the way Sleeper writes it.
 *
 * The season rolls over in March: before March we are still reading last
 * season, from March onward the new one has begun.
 */
export function currentNflSeason(): string {
  const now = new Date();
  const year = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  return String(year);
}
