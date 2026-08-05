import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getSleeperUser,
  getSleeperLeagues,
  currentNflSeason,
} from "@/lib/sleeper";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  loadSearchedTeamStatuses,
  type LeagueTeamStatusSummary,
} from "@/lib/league-team-status-data";
import { loadBulkSyncState } from "@/lib/league-bulk-sync";
import {
  loadPlayerExposure,
  EMPTY_PLAYER_EXPOSURE,
  type PlayerExposure,
} from "@/lib/player-exposure";
import type { ProjectionInput } from "@/lib/league-projections";
import { LeagueResults } from "@/app/tools/league-pulse/league-results";
import { LeagueQuickLinks } from "@/components/league-quick-links";
import { SleeperConnection } from "./sleeper-connection";

export const metadata: Metadata = {
  title: "My Sleeper Leagues",
  description:
    "Save your Sleeper username and view every active league in one accessible table.",
};

export default async function SleeperLeaguesPage() {
  const supabase = await createClient();
  // Layout already gated on auth, but re-fetching the user here is cheap
  // and keeps this page self-contained for the data fetches below.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user!.id)
    .maybeSingle();

  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);
  const sleeperUsername = settings.username ?? "";
  const featuredLeagueId = settings.featured_league_id ?? null;
  const shownLeagueIds = settings.shown_league_ids ?? [];
  const season = currentNflSeason();

  let leagues: Awaited<ReturnType<typeof getSleeperLeagues>> = [];
  let sleeperUser = null;
  // Standing per league, read from cache only. Same contract as the public
  // tool: this page never triggers a sync, so unopened leagues report pending.
  let teamStatuses: Record<string, LeagueTeamStatusSummary> = {};
  // Cross-league views. Both read only what is already stored, so opening either
  // one costs nothing and a league synced later joins them on the next load.
  let exposure: PlayerExposure = EMPTY_PLAYER_EXPOSURE;
  const resolvedSource = await resolveSourceSlug(supabase, undefined);

  // The reader's newest Sync all batch, read through their own session client
  // (the owner-select policies on both queue tables are what scope it). Passing
  // this is also what turns Sync all on: LeagueResults renders the button only
  // when it is present, so the public tool, which never passes it, never shows it.
  const bulkSync = await loadBulkSyncState(supabase, user!.id);
  if (sleeperUsername) {
    sleeperUser = await getSleeperUser(sleeperUsername);
    if (sleeperUser) {
      leagues = await getSleeperLeagues(sleeperUser.user_id, season);
      if (leagues.length > 0) {
        const leagueIds = leagues.map((l) => l.league_id);
        // Independent reads against the same synced rows, so they go together.
        const [statusMap, exposureResult] = await Promise.all([
          loadSearchedTeamStatuses(
            supabase,
            leagueIds,
            sleeperUser.user_id,
            Number(season),
            resolvedSource.slug,
          ),
          loadPlayerExposure(supabase, leagueIds, sleeperUser.user_id),
        ]);
        teamStatuses = Object.fromEntries(statusMap);
        exposure = exposureResult;
      }
    }
  }

  // Every league Sleeper reports, paired with whatever standing we already hold
  // for it. Leagues with no Power Pulse row arrive with a null seed and are
  // counted as unranked rather than dropped, so the panel can say how many are
  // still waiting to be synced.
  const projections: ProjectionInput[] = leagues.map((league) => {
    const summary = teamStatuses[league.league_id] ?? null;
    return {
      sleeperLeagueId: league.league_id,
      leagueName: league.name,
      projectedSeed: summary?.projectedSeed ?? null,
      rankedTeamCount: summary?.rankedTeamCount ?? null,
      statusLabel: summary?.status?.label ?? null,
    };
  });

  return (
    <div className="space-y-12">
      <section aria-labelledby="connect-heading">
        {/* Collapses to one row once a handle is saved. Everything the expanded
            form does is still here, one press away; it just stops being the
            first three inches of the page on every return visit. */}
        <SleeperConnection
          savedUsername={sleeperUsername}
          lookupFailed={Boolean(sleeperUsername) && !sleeperUser}
        />

        {sleeperUsername && !sleeperUser && (
          <p
            role="alert"
            className="mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
          >
            We could not load Sleeper user &quot;{sleeperUsername}&quot;.
            Double-check the spelling above.
          </p>
        )}
      </section>

      <section aria-labelledby="leagues-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionEyebrow>Active leagues</SectionEyebrow>
            <h2
              id="leagues-heading"
              className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Your {season} season
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Every league in one place. Click a name to open its deep view, use
              the star and eye on each row to control what your public profile
              shows, and use the quick links below to look across all of them at
              once.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Link
              href="/tools/league-pulse"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
            >
              Use the public League Pulse tool
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/tools/signal-check#sleeper-import"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
            >
              Analyze a completed trade with Signal Check
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {!sleeperUsername && (
          <EmptyState
            title="No Sleeper username saved yet."
            body="Add yours above and we'll pull every active league for the current season."
          />
        )}

        {sleeperUser && leagues.length === 0 && (
          <EmptyState
            title={`No active leagues found for ${season}.`}
            body="If you joined a league after this page loaded, refresh to pick it up."
          />
        )}

        {leagues.length > 0 && (
          <div className="mt-6">
            {/* Cross-league views sit above the per-league table, because they
                are the summary and the table is the detail. Dashboard only:
                the public tool has no account to gather leagues against. */}
            <LeagueQuickLinks
              exposure={exposure}
              projections={projections}
              sleeperUsername={
                sleeperUser?.display_name ?? sleeperUsername ?? null
              }
              sleeperLeagueIds={leagues.map((l) => l.league_id)}
              sleeperUserId={sleeperUser?.user_id ?? null}
            />
            <LeagueResults
              variant="dashboard"
              leagues={leagues}
              season={season}
              sleeperUsername={
                sleeperUser?.display_name ?? sleeperUsername ?? null
              }
              featuredLeagueId={featuredLeagueId}
              shownLeagueIds={shownLeagueIds}
              teamStatuses={teamStatuses}
              sourceSlug={resolvedSource.slug}
              bulkSync={bulkSync}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- UI helpers ---------- */

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 flex items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Trophy className="h-5 w-5" />
      </span>
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
