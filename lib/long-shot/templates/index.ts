/**
 * Every Long Shot template family, in plan order (7.2). A day uses five
 * distinct families chosen by generate.ts.
 */

import { gameLine } from "./game-line";
import { leagueTrades } from "./league-trades";
import { marketRank } from "./market-rank";
import { opponentLine } from "./opponent-line";
import { seasonFinish } from "./season-finish";
import type { TemplateFamily } from "./types";
import { valueMover } from "./value-mover";
import { waiverWire } from "./waiver-wire";

export const FAMILIES: readonly TemplateFamily[] = [
  gameLine,
  opponentLine,
  seasonFinish,
  marketRank,
  valueMover,
  waiverWire,
  leagueTrades,
];
