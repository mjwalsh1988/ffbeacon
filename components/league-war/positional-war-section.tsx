/**
 * The Positional WAR panel, with its own compute, inside its own boundary.
 *
 * WHY THIS EXISTS AND WHAT IT FIXES. `refreshPositionalWar` was a fourth
 * parallel stage inside `pulseLeagueDerived`, which is correct as far as the
 * write path goes: it reads no roster and no Power Pulse output, so it has no
 * ordering constraint against the other three. The problem was who AWAITS that
 * function. On the overview, `pulseLeagueDerived` is awaited by the component
 * that renders the RANKINGS TABLE, not by the one that renders the curve. So a
 * cold fingerprint, which costs about ten seconds of universe read, was holding
 * up the page's primary content while the curve's own skeleton resolved
 * instantly against data that was already written by the time it looked.
 *
 * The panel's Suspense fallback was doing nothing, and the rankings skeleton
 * was doing the panel's waiting.
 *
 * So the compute moved here, behind the boundary that actually shows it. Pages
 * pass `includePositionalWar: false` to `pulseLeagueDerived`, and the rankings
 * table paints as fast as it did before this feature existed. Scripts and the
 * refresh endpoint still get everything from one `pulseLeague` call.
 *
 * `refreshPositionalWar` never throws and gates itself on the fingerprint, the
 * TTL and the retry backoff, so mounting this is cheap on every view after the
 * first: a small select, and a return.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { refreshPositionalWar } from "@/lib/league-positional-war";
import { PositionalWarPanel } from "./positional-war-panel";
import { parseAxisMode } from "@/lib/positional-war/chart-geometry";
import type { ScoringSettings } from "@/lib/league-scoring";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export async function PositionalWarSection({
  supabase,
  leagueRowId,
  leagueName,
  season,
  teamCount,
  rosterPositions,
  scoringSettings,
  searchedUsername,
  focusedRosterId,
  war,
  variant,
  exploreHref,
  formatConfigId,
  sourceSlug,
  sourceDisplay,
  formatDisplay,
}: {
  /** The cookie-bound read client the panel reads through. */
  supabase: SupabaseClient<Database>;
  leagueRowId: string;
  leagueName: string;
  season: number;
  teamCount: number;
  rosterPositions: string[];
  scoringSettings: ScoringSettings;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  war?: string | string[] | null;
  variant: "dashboard" | "preview";
  exploreHref?: string;
  formatConfigId?: string | null;
  sourceSlug?: string | null;
  sourceDisplay?: string;
  formatDisplay?: string;
}) {
  // Service role, because this writes. The panel below reads through the
  // caller's client, which is anon-scoped and correct for a public table.
  await refreshPositionalWar(createAdminClient(), leagueRowId);

  return (
    <PositionalWarPanel
      supabase={supabase}
      leagueRowId={leagueRowId}
      leagueName={leagueName}
      season={season}
      teamCount={teamCount}
      rosterPositions={rosterPositions}
      scoringSettings={scoringSettings}
      searchedUsername={searchedUsername}
      focusedRosterId={focusedRosterId}
      // The preview is one point and a link onward, so it never offers the
      // axis toggle and always draws the default axis.
      axisMode={variant === "preview" ? "rank" : parseAxisMode(war)}
      variant={variant}
      exploreHref={exploreHref}
      formatConfigId={formatConfigId}
      sourceSlug={sourceSlug}
      sourceDisplay={sourceDisplay}
      formatDisplay={formatDisplay}
    />
  );
}
