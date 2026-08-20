import type { NavIconName } from "@/components/app-shell/nav-icons";

/**
 * One icon per Beacon Brief category, so a list of them is not nine identical
 * glyphs.
 *
 * Read by both places categories are listed outside the filter rail: the site
 * navigation rail (brief-rail-sections.tsx) and the Category menu on the
 * docking bar below xl (brief-shell.tsx). Kept here so the two cannot drift.
 *
 * Categories are DB rows, so a new one that is not named here falls back to the
 * Brief's own icon rather than breaking.
 */
export const CATEGORY_ICONS: Record<string, NavIconName> = {
  injuries: "activity",
  transactions: "swap",
  "depth-chart-usage": "layers",
  "suspensions-legal": "flag",
  "performance-game-notes": "gauge",
  "coaching-scheme": "workflow",
  "roster-moves": "users",
  "draft-rookies": "graduationCap",
  general: "newspaper",
};
