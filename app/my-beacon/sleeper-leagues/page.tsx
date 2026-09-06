import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
} from "@/lib/sleeper-handle/resolve";
import { deriveStatusVariant } from "@/lib/sleeper-to-format";
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
import { SleeperIdentityCard } from "@/components/sleeper-handle/identity-card";
import { SaveHandleForm } from "@/components/sleeper-handle/save-handle-form";

export const metadata: Metadata = {
  title: "My Sleeper Leagues",
  description:
    "Save your Sleeper username and view every active league in one accessible table.",
};

/**
 * The settings page for the reader's Sleeper connection, and the league table
 * that connection produces.
 *
 * THIS PAGE IS THE DESTINATION, NOT A PROMPT
 *   Every tool that shows an identity card links here with "Manage your Sleeper
 *   connection", so there is no save-your-handle notice on this page: a notice
 *   pointing at the page you are already reading is noise. For the same reason
 *   the form here is `mode="settings"`, which always saves. There is no "just
 *   this once" checkbox, because saving is the only thing this page does.
 *
 * ONE SLEEPER CALL, NOT TWO
 *   The saved identity carries the Sleeper user id (D3), so the league list is
 *   fetched straight from it. `ensureSleeperUserId` fills that id in for a row
 *   saved before migration 0268 and writes it back, so the next visit is one
 *   call too. A handle that no longer resolves leaves the id null, which is the
 *   `failed` state: the card opens its own form and says so as an alert.
 */
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

  // The LEAGUE keys of the jsonb only. The reader's identity comes from the
  // resolver below; lib/sleeper-handle/guard.test.ts is what keeps it that way.
  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);
  const featuredLeagueId = settings.featured_league_id ?? null;
  const shownLeagueIds = settings.shown_league_ids ?? [];
  const season = currentNflSeason();

  const saved = await loadSavedSleeperHandle(supabase);
  // A row written before migration 0268 has no id yet. One lookup fills it in
  // and stores it; a failed lookup returns the handle unchanged, which is the
  // "no longer resolves" state below rather than a reason to clear anything.
  const handle =
    saved && !saved.sleeperUserId
      ? await ensureSleeperUserId(supabase, saved)
      : saved;
  const sleeperUserId = handle?.sleeperUserId ?? null;
  const lookupFailed = Boolean(handle) && !sleeperUserId;

  let leagues: Awaited<ReturnType<typeof getSleeperLeagues>> = [];
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

  if (sleeperUserId) {
    leagues = await getSleeperLeagues(sleeperUserId, season);
    if (leagues.length > 0) {
      const leagueIds = leagues.map((l) => l.league_id);
      // Independent reads against the same synced rows, so they go together.
      const [statusMap, exposureResult] = await Promise.all([
        loadSearchedTeamStatuses(
          supabase,
          leagueIds,
          sleeperUserId,
          Number(season),
          resolvedSource.slug,
          // Redraft rooms get the redraft wording on their tag. Read off the
          // Sleeper payload we already have rather than our own table.
          Object.fromEntries(
            leagues.map((l) => [l.league_id, deriveStatusVariant(l)]),
          ),
        ),
        loadPlayerExposure(supabase, leagueIds, sleeperUserId),
      ]);
      teamStatuses = Object.fromEntries(statusMap);
      exposure = exposureResult;
    }
  }

  // What the league table and the cross-league panels match a roster against.
  // Sleeper's display name is what league_users stores, so it leads; the handle
  // is the fallback for an identity saved before we captured a display name.
  const rosterMatchName = handle?.displayName ?? handle?.username ?? null;

  // Every league Sleeper reports, paired with whatever standing we already hold
  // for it. Leagues with no Power Pulse row arrive with a null seed and are
  // counted as unranked rather than dropped, so the panel can say how many are
  // still waiting to be synced.
  const projections: ProjectionInput[] = leagues.map((league) => {
    const summary = teamStatuses[league.league_id] ?? null;
    return {
      sleeperLeagueId: league.league_id,
      leagueName: league.name,
      // Straight off the live Sleeper payload; there is no avatar column on
      // `leagues` and none is to be added.
      avatar: league.avatar ?? null,
      projectedSeed: summary?.projectedSeed ?? null,
      rankedTeamCount: summary?.rankedTeamCount ?? null,
      statusLabel: summary?.status?.label ?? null,
    };
  });

  return (
    <div className="space-y-6">
      {handle ? (
        /* The card is its own labelled section, so it is not wrapped in a
           second one. Connected, the whole connection is one row plus the way
           back into the form, instead of the pitch a returning reader has
           already read. */
        <SleeperIdentityCard
          // This page IS the settings page, so the footer link would point here.
          manageHref={null}
          toolName="My Beacon"
          handle={handle}
          headingLevel={2}
          status={lookupFailed ? "failed" : "idle"}
          statusMessage={
            lookupFailed
              ? `Sleeper no longer has an account called "${handle.username}", so we could not load your leagues. Save the handle you use now and they will come back.`
              : null
          }
        >
          <SaveHandleForm
            defaultUsername={handle.username}
            submitLabel="Save username"
          />
        </SleeperIdentityCard>
      ) : (
        <section aria-labelledby="connect-heading">
          <SectionEyebrow>Sleeper connection</SectionEyebrow>
          <h2
            id="connect-heading"
            className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Link your Sleeper username.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            We save your handle so every visit auto-loads your leagues, no
            re-typing, no re-pasting. Change it anytime.
          </p>
          <div className="mt-6 rounded-card border border-line bg-surface p-5">
            <SaveHandleForm submitLabel="Save username" />
          </div>
        </section>
      )}

      <section aria-labelledby="leagues-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionEyebrow>Active leagues</SectionEyebrow>
            <h2
              id="leagues-heading"
              className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
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

        {!handle && (
          <EmptyState
            title="No Sleeper username saved yet."
            body="Add yours above and we'll pull every active league for the current season."
          />
        )}

        {sleeperUserId && leagues.length === 0 && (
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
              sleeperUsername={rosterMatchName}
              sleeperLeagueIds={leagues.map((l) => l.league_id)}
              sleeperUserId={sleeperUserId}
              sourceSlug={resolvedSource.slug}
            />
            <LeagueResults
              variant="dashboard"
              leagues={leagues}
              season={season}
              sleeperUsername={rosterMatchName}
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
