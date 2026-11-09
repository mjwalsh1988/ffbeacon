/**
 * Family 11, college_path (plan 31.3): a player at one position from one
 * college program who played in the NFL in or after a year. Source:
 * history_players.college (the nflverse players and draft files).
 */

import { grid, positionOf } from "./shared";
import { historyOpen, historyPlayersFrom, noun } from "./history-shared";
import type { TemplateFamily } from "./types";

/** Label as a prompt says it, and the spellings the source uses. */
export const COLLEGES: Array<{ label: string; match: string[] }> = [
  { label: "Alabama", match: ["Alabama"] },
  { label: "Ohio State", match: ["Ohio State"] },
  { label: "LSU", match: ["LSU", "Louisiana State"] },
  { label: "Michigan", match: ["Michigan"] },
  { label: "USC", match: ["USC", "Southern California", "Southern Cal"] },
  { label: "Notre Dame", match: ["Notre Dame"] },
  { label: "Oklahoma", match: ["Oklahoma"] },
  { label: "Texas", match: ["Texas"] },
  { label: "Georgia", match: ["Georgia"] },
  { label: "Florida", match: ["Florida"] },
  { label: "Florida State", match: ["Florida State", "Florida St."] },
  { label: "Miami", match: ["Miami", "Miami (FL)", "Miami (Fla.)"] },
  { label: "Penn State", match: ["Penn State", "Penn St."] },
  { label: "Clemson", match: ["Clemson"] },
  { label: "Oregon", match: ["Oregon"] },
  { label: "Wisconsin", match: ["Wisconsin"] },
  { label: "Tennessee", match: ["Tennessee"] },
  { label: "Auburn", match: ["Auburn"] },
  { label: "Nebraska", match: ["Nebraska"] },
  { label: "UCLA", match: ["UCLA"] },
  { label: "Texas A&M", match: ["Texas A&M"] },
  { label: "Stanford", match: ["Stanford"] },
  { label: "Washington", match: ["Washington"] },
  { label: "Iowa", match: ["Iowa"] },
];
const SINCE = [1980, 1990, 2000, 2010];

export const collegePath: TemplateFamily = {
  key: "college_path",
  enabledByDefault: true,
  source: "history_careers",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const since = SINCE.filter((y) => y >= ctx.historyFloorSeason && y < ctx.season - 5);
    if (since.length === 0) return [];
    return grid(rng, { college: COLLEGES.map((c) => c.label), position: ["QB", "RB", "WR", "TE"], since });
  },
  position: positionOf,
  text(params) {
    return `Name a ${noun(params.position)} from ${String(params.college)} who played in the NFL in ${Number(params.since)} or later.`;
  },
  answers(admin, params, ctx) {
    const college = COLLEGES.find((c) => c.label === params.college);
    const match = college?.match ?? [String(params.college)];
    return historyPlayersFrom("long shot college path", ctx, (from, to) =>
      admin
        .from("history_players")
        .select("id, player_id")
        .in("college", match)
        .eq("position", String(params.position))
        .gte("last_season", Number(params.since))
        .order("id", { ascending: true })
        .range(from, to),
    );
  },
};
