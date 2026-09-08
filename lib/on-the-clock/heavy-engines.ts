/**
 * Barrel for the On The Clock engines that answer questions about a view other
 * than the room's default "Who to pick" screen: the trade catalog, team
 * rollups, awards, grades, pick surplus, trade margins, and the recap text.
 *
 * PERF-T031 (docs/performance/site-speed-audit-and-plan.md 4.10). None of this
 * is needed on the first paint of a live draft: on-the-clock-client.tsx loads
 * it through a dynamic import once the reader opens a view besides "pick" (or
 * the draft ends), so awards.ts alone (1,285 lines) never reaches a reader who
 * only ever checks who to pick. Keep this file a pure re-export, nothing else,
 * so the dynamic import stays a single clean chunk boundary.
 */

export { buildTradeCatalog, buildPickValueLookup, lookupPickValue } from "./trade-analyzer";
export { buildTeamRollups } from "./rosters";
export { computeDraftAwards } from "./awards";
export { computeDraftGrades } from "./draft-grade";
export { computePickSurplus, buildMarketCurve } from "./surplus";
export { tradeMarginsFor } from "./trade-margins";
export { computePassedOn, buildRecapText } from "./draft-recap";
