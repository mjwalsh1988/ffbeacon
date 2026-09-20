/**
 * What the size of the surviving field does to a price.
 *
 * Its own tiny module, and pure, because the manual calculator needs it in
 * the BROWSER. Importing it from lib/faab/league-chopped.ts pulled the whole
 * chopped engine, the survival simulation included, into the client bundle
 * to read four numbers off a settings object.
 *
 * Money loses value as teams are eliminated: the pool fills with starters
 * while the number of bidders falls. Fantasy Life's 2024 guillotine medians
 * have the same player losing 22% (Jefferson) to 77% (St. Brown) of his
 * price between about 13 teams alive and about 6, and the NFFC Eliminator
 * study has top-12 running backs at 28.9% of budget with half the field
 * alive, 12.8% at 30 to 50%, and 0% below that.
 */

import type { ChoppedSettings } from "@/lib/faab/types";

export function priceByAliveFraction(fraction: number, settings: ChoppedSettings): number {
  for (const band of settings.priceByAliveFraction) {
    if (fraction >= band.minFraction) return band.multiplier;
  }
  return settings.priceByAliveFraction[settings.priceByAliveFraction.length - 1]?.multiplier ?? 1;
}
