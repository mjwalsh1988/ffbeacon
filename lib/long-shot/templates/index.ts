/**
 * Every Long Shot template family, in plan order (7.2 and 31.3). A day uses
 * five distinct families from five different sources, chosen by generate.ts.
 */

import { careerMarks } from "./career-marks";
import { careerSpan } from "./career-span";
import { collegePath } from "./college-path";
import { draftClass } from "./draft-class";
import { franchiseEra } from "./franchise-era";
import { gameLine } from "./game-line";
import { historyFinish } from "./history-finish";
import { historyStatLine } from "./history-stat-line";
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
  franchiseEra,
  careerSpan,
  draftClass,
  collegePath,
  careerMarks,
  historyStatLine,
  historyFinish,
];
