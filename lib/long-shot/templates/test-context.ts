/** A fixed generation context for template and generator tests. Test-only. */

import type { GenerationContext } from "./types";

export function fakeCtx(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    season: 2026,
    seasons: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
    completedWeek: 8,
    defaultSource: { slug: "ffbeacon", display: "FF Beacon" },
    defaultSourceFormats: null,
    formats: [
      { id: "f1", slug: "dynasty-ppr-sflex", display_name: "Dynasty PPR Superflex" },
      { id: "f2", slug: "dynasty-ppr-std", display_name: "Dynasty PPR 1QB" },
      { id: "f3", slug: "redraft-ppr-std", display_name: "Redraft PPR" },
    ],
    rateSeason: 2026,
    now: new Date("2026-11-08T17:00:00Z"),
    historyFloorSeason: 1950,
    historyReady: true,
    recentKeys: new Set(),
    modernPool: new Set(),
    ...overrides,
  };
}
