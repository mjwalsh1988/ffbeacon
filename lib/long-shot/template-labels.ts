/** Plain names for the prompt families, for the admin page. */

import type { TemplateKey } from "./types";

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  game_line: "Game line",
  opponent_line: "Line against an opponent",
  season_finish: "Season finish",
  market_rank: "Market rank (two boards)",
  value_mover: "Value mover",
  waiver_wire: "Waiver wire",
  league_trades: "League trades",
  franchise_era: "Franchise era (history)",
  career_span: "Career span (history)",
  draft_class: "Draft class (history)",
  college_path: "College (history)",
  career_marks: "Career marks (history)",
  history_stat_line: "Stat line since 1999 (history)",
  history_finish: "Season finish since 1999 (history)",
};
