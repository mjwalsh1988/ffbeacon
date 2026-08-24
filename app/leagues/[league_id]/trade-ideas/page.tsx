import type { Metadata } from "next";
import { Suspense, cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, describeDerived } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { LeagueShell } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { TradeFinder, type PlayerOption } from "@/components/trade-finder";
import { ModeTabs, type TradeIdeasMode } from "@/components/trade-ideas/mode-tabs";
import { EvaluationState } from "@/components/trade-ideas/evaluation-states";
import { TradeVerdict } from "@/components/trade-ideas/trade-verdict";
import { YourTeamPanel } from "@/components/trade-ideas/your-team-panel";
import {
  TradeBuilder,
  type BuilderTeam,
} from "@/components/trade-ideas/trade-builder";
import { loadTradeFinderLeague } from "@/lib/trade-finder-data";
import { loadDeclinedKeys } from "@/lib/trade-finder-declines";
import { findTrades } from "@/lib/trade-finder/engine";
import { gradeSuggestions } from "@/lib/trade-finder-grade";
import { loadSavedKeys } from "@/lib/trade-finder-saves";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
import { loadPowerPulseView } from "@/lib/league-power-pulse-data";
import {
  decodeProposal,
  encodeProposalQuery,
  type ProposalParams,
} from "@/lib/trade-impact/proposal-url";
import {
  claimTradeEntrySlot,
  claimTradeEvaluationSlot,
  claimTradeSuggestionSlot,
} from "@/lib/trade-impact/rate-limit";
import {
  evaluateValidatedTrade,
  validateProposal,
} from "@/lib/trade-impact/evaluate";
import type { TradeProposal } from "@/lib/trade-impact/types";
import {
  TRADE_POSITIONS,
  readTradePosition,
  type TradePosition,
} from "@/lib/trade-finder/types";

/**
 * Suggestions handed to the client on first paint.
 *
 * Matches the search action's window, so the tab opens with the same amount of
 * ranking behind the arrows that a Search press would hand back.
 */
const INITIAL_WINDOW = 12;

export const dynamic = "force-dynamic";

/**
 * Build mode's league read, done once per request.
 *
 * Three separate places on the page need the same rosters, values, and picks:
 * the builder's asset lists, the rail's "your team" figures, and the identity
 * check that works out which roster belongs to the reader. Wrapped in
 * `React.cache` and keyed on primitives, so those three are one read rather than
 * three, without any of them having to know about the others or be reordered
 * into a single component.
 *
 * The derived pulse runs inside it for the same reason the suggestion section
 * awaits it: the Power Pulse cache and the transaction history are what the
 * status labels and the rail figures come from, and they have to exist before
 * either is read.
 */
const loadBuilderLeague = cache(
  async (
    sleeperLeagueId: string,
    leagueRowId: string,
    resynced: boolean,
    sourceSlug: string | null,
    searchedUsername: string | null,
    rosterParam: number | null,
  ) => {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    await pulseLeagueDerived(adminClient, leagueRowId, { resynced });
    return loadTradeFinderLeague(supabase, {
      sleeperLeagueId,
      sourceSlug,
      identity: { username: searchedUsername, rosterId: rosterParam },
    });
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league_id: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("name")
    .eq("sleeper_league_id", league_id)
    .maybeSingle();
  if (!league) return { title: "League not found" };

  const title = `${league.name} Trade Ideas`;
  const description = `Trades worth offering in ${league.name}, and a builder that grades any deal you propose against your lineup and your value.`;
  const ogPath = `/api/og/league/${league_id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, images: [ogPath] },
  };
}

export default async function LeagueTradeFinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<
    {
      source?: string;
      username?: string;
      roster?: string;
      mode?: string;
    } & ProposalParams
  >;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const mode: TradeIdeasMode = sp.mode === "build" ? "build" : "suggested";
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim() ? sp.username.trim() : null;
  const rosterParam = (() => {
    if (typeof sp.roster !== "string" || !sp.roster.trim()) return null;
    const n = Number.parseInt(sp.roster, 10);
    return Number.isFinite(n) ? n : null;
  })();

  // The same first-touch pulse every deep-view surface runs, so this tab works
  // as a direct link rather than only after somebody visited Overview. Core
  // only: the derived half feeds the suggestion engine, so it runs inside the
  // streamed section below instead of holding the header back.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeagueCore(adminClient, sleeperLeagueId);
  if (!pulseResult.ok) notFound();

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    searchedUsername,
    league.season != null ? String(league.season) : null,
  );

  const qs = searchedUsername
    ? `?username=${encodeURIComponent(searchedUsername)}`
    : "";
  const homeHref = `/tools/league-pulse${qs}`;
  const leagueHref = `/leagues/${sleeperLeagueId}${qs}`;

  // Format is the league's own; only the value source follows the reader.
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
  const sleeperLeague = league.metadata as unknown as Parameters<
    typeof resolveLeagueContext
  >[1];
  const context = await resolveLeagueContext(
    adminClient,
    sleeperLeague,
    resolvedSource.slug,
  );
  const coverageOk = context.coverage !== "none";

  const lastPulsed = league.last_pulsed_at ? new Date(league.last_pulsed_at) : null;
  const mastheadProps = {
    leagueName: league.name,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags: buildLeagueFormatTags({
      rosterPositions: league.roster_positions,
      scoringSettings: league.scoring_settings,
      teamCount: league.total_rosters,
    }),
    scoringTags: buildLeagueScoringTags(league.scoring_settings),
    lastUpdatedLabel: lastPulsed ? formatRelative(lastPulsed) : "never",
    cached: pulseResult.cached,
    coverage: context.coverage,
    sourceDisplay: coverageOk ? context.sourceDisplay : "N/A",
    formatDisplay: coverageOk ? context.formatDisplay : "N/A",
    derivedLabel: describeDerived(context.derived),
    fallbackDisplay:
      context.coverage === "fallback" ? (context.fallback?.derivedDisplay ?? null) : null,
    pickSourceDisplay:
      coverageOk && context.pickSource && context.pickSource.slug !== context.sourceSlug
        ? context.pickSource.display
        : null,
  };

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="trade-ideas"
      searchedUsername={searchedUsername}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Trade Ideas" }]}
      copyHref={`/leagues/${sleeperLeagueId}/trade-ideas`}
      copyAriaLabel="Copy link to this league's Trade Ideas"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <>
        <section
          aria-labelledby="tf-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.13) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          {/* The masthead above already says League Pulse, so this eyebrow
              names what the section does instead of repeating the brand. */}
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">
            Offer builder
          </p>
          {/* An h2: the masthead above owns this page's h1 (the league name). */}
          <h2
            id="tf-intro"
            className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
          >
            Trade Ideas
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            One deal at a time, built from every roster in this league.
          </p>
        </section>

        {/* Both modes are addresses, so the tabs sit above whichever one is
            showing rather than inside it. */}
        <div className="mt-4">
          <ModeTabs
            active={mode}
            sleeperLeagueId={sleeperLeagueId}
            searchedUsername={searchedUsername}
            source={sp.source ?? null}
            rosterId={rosterParam}
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {mode === "build" ? (
              // Streamed for the same reason the suggestion browser is: the
              // rosters, values, and projections behind the asset lists take a
              // couple of seconds, and the masthead, the tabs, and the rail have
              // no reason to wait on them.
              <Suspense fallback={<BuilderSkeleton />}>
                <BuildSection
                  sleeperLeagueId={sleeperLeagueId}
                  leagueRowId={league.id}
                  resynced={!pulseResult.cached}
                  sourceSlug={resolvedSource.slug}
                  searchedUsername={searchedUsername}
                  rosterParam={rosterParam}
                  proposalParams={{ with: sp.with, in: sp.in, out: sp.out }}
                />
              </Suspense>
            ) : (
              <>
                {/* The intro strip above owns an h2, so the working area needs
                    one of its own rather than opening on an h3 inside the
                    card. */}
                <h2 className="sr-only">Suggested trade</h2>
                {/* Streamed. Reading a league is a couple of seconds of rosters,
                    values, and projections, and holding the whole page on it
                    would mean the tabs and the league identity arrive at the
                    same time as the deal. The header paints first and this fills
                    in behind it, matching how the Overview tab streams its
                    rankings. */}
                <Suspense fallback={<FinderSkeleton />}>
                  <TradeFinderSection
                    sleeperLeagueId={sleeperLeagueId}
                    leagueRowId={league.id}
                    resynced={!pulseResult.cached}
                    sourceSlug={resolvedSource.slug}
                    searchedUsername={searchedUsername}
                    rosterParam={rosterParam}
                    isSignedIn={Boolean(user)}
                  />
                </Suspense>
              </>
            )}
          </div>

          <aside
            aria-label="About these numbers"
            className="space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
          >
            {/* Build mode only. It is the scale the evaluation's figures are
                read against: "adds 4.3 points a week" means something different
                next to 6.4 projected wins than next to 9.1. On the suggested
                tab the card carries its own before-and-after, so the panel would
                be repeating what is already on screen. */}
            {mode === "build" && (
              <Suspense fallback={<YourTeamSkeleton />}>
                <YourTeamRail
                  sleeperLeagueId={sleeperLeagueId}
                  leagueRowId={league.id}
                  resynced={!pulseResult.cached}
                  sourceSlug={resolvedSource.slug}
                  formatConfigId={context.formatConfigId}
                  season={league.season ?? null}
                  searchedUsername={searchedUsername}
                  rosterParam={rosterParam}
                />
              </Suspense>
            )}

            {/* Sources, not a lesson. Each line names one input and stops; the
                reasoning behind them belongs in the docs, not in a rail the
                reader passes every time they open the tab. */}
            <Panel eyebrow="How this works" title="Where the numbers come from">
              <dl className="space-y-2 text-sm text-ink-muted">
                <SourceLine
                  term="Standings"
                  detail="Power Pulse, same as the rankings table"
                />
                <SourceLine
                  term="Lineup impact"
                  detail="your optimal lineup under this league's scoring"
                />
                <SourceLine
                  term="Values"
                  detail={`${mastheadProps.formatDisplay} via ${mastheadProps.sourceDisplay}${
                    mastheadProps.pickSourceDisplay
                      ? `, picks via ${mastheadProps.pickSourceDisplay}`
                      : ""
                  }`}
                />
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
                We cannot see what another manager is attached to. These are
                offers, not predictions.
              </p>
            </Panel>
          </aside>
        </div>
      </>
    </LeagueShell>
  );
}

/**
 * The part that actually costs something.
 *
 * Split out so it can stream. It opens the league (rosters, values,
 * projections), runs the engine once for the reader's own team, and grades the
 * one suggestion it is about to show. Everything above it on the page, the
 * header, the tabs, the league identity card, renders without waiting for any
 * of it.
 *
 * The first suggestion is produced HERE rather than by a button press, so the
 * tab opens on a deal instead of on an empty form.
 */
async function TradeFinderSection({
  sleeperLeagueId,
  leagueRowId,
  resynced,
  sourceSlug,
  searchedUsername,
  rosterParam,
  isSignedIn,
}: {
  sleeperLeagueId: string;
  leagueRowId: string;
  resynced: boolean;
  /** Null when the registry has no active value source at all. */
  sourceSlug: string | null;
  searchedUsername: string | null;
  rosterParam: number | null;
  isSignedIn: boolean;
}) {
  // THE SUGGESTION ENGINE RUNS ON A PLAIN GET, so it needs a meter of its own.
  //
  // `mode` defaults to suggested, so loading this page runs `findTrades` (a
  // combinatorial search over every counterparty) and grades the shortlist
  // through the Signal Check pipeline. The server action that produces the SAME
  // suggestions from the SAME engine has claimed a slot since it was written,
  // which meant an attacker who never pressed Search got the engine for free,
  // and `force-dynamic` guarantees no CDN absorbs it. Matched to the action's
  // own ceiling, because it is the same work.
  const suggestAllowed = await claimTradeSuggestionSlot();
  if (!suggestAllowed) {
    return (
      <EvaluationState
        kind="rate-limited"
        message="You have loaded a lot of suggestions in the last minute. Give it a moment and reload."
      />
    );
  }

  const supabase = await createClient();
  const adminClient = createAdminClient();

  // Through the request-scoped cache, not a second direct read. The two modes
  // are mutually exclusive today so this costs nothing yet, and it is a loaded
  // gun otherwise: the moment anything else on suggested mode needs the league,
  // the page does two full loadTradeFinderLeague reads. loadBuilderLeague also
  // awaits the derived pulse, which the engine needs for transaction history and
  // the Power Pulse cache.
  const finderLeague = await loadBuilderLeague(
    sleeperLeagueId,
    leagueRowId,
    resynced,
    sourceSlug,
    searchedUsername,
    rosterParam,
  );

  if (!finderLeague) {
    return (
      <Panel eyebrow="Not ready" title="Nothing to search yet">
        <p className="text-sm leading-relaxed text-ink-muted">
          No value source covers this league&apos;s format, so there is nothing
          to price trades against. See the Overview tab.
        </p>
      </Panel>
    );
  }

  const myRosterId = finderLeague.myRosterId;
  if (myRosterId === null) {
    return (
      <TeamChooser
        teams={finderLeague.teams.map((t) => ({
          rosterId: t.rosterId,
          teamName: t.teamName,
          ownerHandle: t.ownerHandle,
        }))}
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
      />
    );
  }

  // Stored passes are read through the reader's own session client, so the owner
  // policies scope them. A signed-out reader has none, and their passes live in
  // the component for the visit.
  const declined = isSignedIn ? await loadDeclinedKeys(supabase, sleeperLeagueId) : [];

  // The consolidation model, read from the same admin settings Signal Check and
  // the search action use. Without it this first paint would be assembled by
  // plain addition while every later search used the quality gate, so the tab
  // would open on a deal its own Search button could not reproduce.
  const signalCheckSettings = await loadSignalCheckSettings(adminClient).catch(() => null);
  const qualityConfig =
    signalCheckSettings && signalCheckSettings.qualityEnabled
      ? signalCheckSettings.quality
      : DEFAULT_TRADE_QUALITY_CONFIG;

  const initialResult = findTrades({
    myRosterId,
    teams: finderLeague.teams,
    startingSlots: finderLeague.startingSlots,
    isDynasty: finderLeague.isDynasty,
    allowPicks: finderLeague.allowPicks,
    goal: "balanced",
    targetPlayerId: null,
    offerPlayerId: null,
    excludeKeys: declined,
    quality: { config: qualityConfig, poolMax: finderLeague.poolMax },
  });
  const initialSuggestions = initialResult.suggestions.slice(0, INITIAL_WINDOW);
  const initialGrades = await gradeSuggestions(
    adminClient,
    finderLeague.sleeperLeague,
    initialSuggestions,
  );
  const initialSavedKeys = isSignedIn ? await loadSavedKeys(supabase) : [];

  // Picker options. Both lists carry position and team so two players with the
  // same surname are told apart in a select a screen reader is reading aloud.
  //
  // The same walk records which position groups this league actually holds a
  // priced player at, which is what the position chips are drawn from. Derived
  // rather than assumed: a league with no kicker slot must not be offered a
  // kicker chip whose only possible answer is "no trade found", and a league
  // that starts two of them must be.
  const myPlayers: PlayerOption[] = [];
  const theirPlayers: PlayerOption[] = [];
  const positionsHeld = new Set<TradePosition>();
  for (const team of finderLeague.teams) {
    for (const p of team.players) {
      if (!p.hasValue) continue;
      const position = readTradePosition(p.position);
      if (position) positionsHeld.add(position);
      const option: PlayerOption = {
        playerId: p.playerId,
        label: `${p.name} (${p.position}${p.team ? `, ${p.team}` : ""})`,
        group: team.teamName,
      };
      if (team.rosterId === myRosterId) myPlayers.push(option);
      else theirPlayers.push(option);
    }
  }
  const byLabel = (a: PlayerOption, b: PlayerOption) => a.label.localeCompare(b.label);
  myPlayers.sort(byLabel);
  theirPlayers.sort(byLabel);
  const availablePositions = TRADE_POSITIONS.filter((p) => positionsHeld.has(p));

  return (
    <TradeFinder
      mode="league"
      isSignedIn={isSignedIn}
      sleeperLeagueId={sleeperLeagueId}
      searchedUsername={searchedUsername}
      source={sourceSlug}
      // What makes "Open in builder" possible on a card: the builder needs to
      // know whose side of the deal is whose, and only the page knows that.
      myRosterId={myRosterId}
      myTeamName={finderLeague.teams.find((t) => t.rosterId === myRosterId)?.teamName ?? null}
      myPlayers={myPlayers}
      theirPlayers={theirPlayers}
      availablePositions={availablePositions}
      initial={{
        suggestions: initialSuggestions,
        grades: initialGrades,
        savedKeys: initialSavedKeys,
        meta: {
          leagueName: finderLeague.leagueName,
          formatDisplay: finderLeague.formatDisplay,
          sourceDisplay: finderLeague.sourceDisplay,
          pickSourceDisplay: finderLeague.pickSourceDisplay,
          consideredTeams: initialResult.consideredTeams,
          lineupUnavailable: initialResult.lineupUnavailable,
          beyondWindow: Math.max(
            0,
            initialResult.suggestions.length - initialSuggestions.length,
          ),
        },
      }}
    />
  );
}

/**
 * Build mode: the evaluation of whatever is in the URL, then the builder.
 *
 * THE EVALUATION IS RENDERED HERE, ON THE SERVER, FROM THE ADDRESS
 *   `?mode=build&with=4&in=...&out=...` is a complete description of a trade, so
 *   the page can answer it without JavaScript, without a session, and without an
 *   action id. That is what makes a built trade shareable and what makes the
 *   back button work. It is also an entry point a loop of GET requests can hit,
 *   which is why the gates below are the same three the server action runs, in
 *   the same order.
 *
 *   1. decodeProposal   shape only, no database, free.
 *   2. validateProposal ownership against `rosters.player_ids`. One league read,
 *                       no projection and no simulation.
 *   3. claimTradeEvaluationSlot, then the expensive half.
 *
 *   Validation before the claim, deliberately. A stale link a reader clicked
 *   must not cost them a slot, and a flood of garbage must gain an attacker
 *   nothing. Reversing the two would charge the honest reader for the dishonest
 *   caller's traffic.
 */
async function BuildSection({
  sleeperLeagueId,
  leagueRowId,
  resynced,
  sourceSlug,
  searchedUsername,
  rosterParam,
  proposalParams,
}: {
  sleeperLeagueId: string;
  leagueRowId: string;
  resynced: boolean;
  sourceSlug: string | null;
  searchedUsername: string | null;
  rosterParam: number | null;
  proposalParams: ProposalParams;
}) {
  // The cheap outer meter, before any read. Loose enough that no real reader
  // meets it; see lib/trade-impact/rate-limit.ts for why it exists at all.
  const entryAllowed = await claimTradeEntrySlot();
  if (!entryAllowed) {
    return (
      <EvaluationState
        kind="rate-limited"
        message="That is a lot of requests in one minute. Give it a moment and reload."
      />
    );
  }

  const finderLeague = await loadBuilderLeague(
    sleeperLeagueId,
    leagueRowId,
    resynced,
    sourceSlug,
    searchedUsername,
    rosterParam,
  );

  if (!finderLeague) {
    return (
      <Panel eyebrow="Not ready" title="Nothing to price a trade against">
        <p className="text-sm leading-relaxed text-ink-muted">
          No value source covers this league&apos;s format, so a proposed trade
          has nothing to be measured in. See the Overview tab.
        </p>
      </Panel>
    );
  }

  const myRosterId = finderLeague.myRosterId;
  if (myRosterId === null) {
    return (
      <TeamChooser
        teams={finderLeague.teams.map((t) => ({
          rosterId: t.rosterId,
          teamName: t.teamName,
          ownerHandle: t.ownerHandle,
        }))}
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
        mode="build"
      />
    );
  }

  // Gate 1. Shape only, and `myRosterId` comes from the identity we just
  // resolved rather than from the link, so a shared address cannot quietly
  // evaluate somebody else's team.
  const decoded = decodeProposal(proposalParams, myRosterId);

  const teams: BuilderTeam[] = finderLeague.teams.map((team) => ({
    rosterId: team.rosterId,
    teamName: team.teamName,
    ownerHandle: team.ownerHandle,
    // Only assets we hold a price for. A player with no value row cannot be put
    // in a package by the engine either, and offering one here would produce a
    // total that quietly understates the side he is on.
    players: team.players
      .filter((p) => p.hasValue)
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        team: p.team,
        value: p.value,
        projPoints: p.projPoints,
      })),
    picks: team.picks
      .filter((p) => p.hasValue)
      .map((p) => ({
        season: p.season,
        round: p.round,
        pickPosition: p.pickPosition,
        // Identity, not decoration. Two 2027 1sts on one roster are two assets
        // with two values, and without the original owner the builder can only
        // offer one of them.
        originalRosterId: p.originalRosterId,
        isOwnPick: p.isOwnPick,
        originalOwnerHandle: p.originalOwnerHandle,
        originalTeamName: p.originalTeamName,
        positionEstimated: p.positionEstimated,
        label: p.label,
        value: p.value,
      })),
  }));

  const myTeam = teams.find((t) => t.rosterId === myRosterId);
  const theirTeam =
    decoded.proposal === null
      ? null
      : (teams.find((t) => t.rosterId === decoded.proposal?.theirRosterId) ?? null);

  /** The builder with nothing in it. Where an unusable link sends the reader. */
  const emptyBuilderHref = (() => {
    const qs = new URLSearchParams({ mode: "build", roster: String(myRosterId) });
    if (searchedUsername) qs.set("username", searchedUsername);
    if (sourceSlug) qs.set("source", sourceSlug);
    return `/leagues/${sleeperLeagueId}/trade-ideas?${qs.toString()}`;
  })();

  /** This exact trade again. What a rate-limited reader presses in a moment. */
  const retryHref =
    decoded.proposal === null
      ? emptyBuilderHref
      : `/leagues/${sleeperLeagueId}/trade-ideas?${encodeProposalQuery(decoded.proposal, {
          searchedUsername,
          source: sourceSlug,
        })}#trade-evaluation`;

  return (
    <div className="space-y-6">
      {/* THE BUILDER SITS ABOVE THE ANSWER.
          It is the thing a reader came here to use, and the deal they just
          assembled is the context for everything under it. Below the evaluation
          it also meant that pressing Evaluate moved the page UP, away from the
          form, with the result somewhere off the bottom. Above it, the anchor
          jump on Evaluate lands on the evaluation as a forward move, which is
          what "show me the answer" should feel like.

          Keyed on the trade in the address. Pressing Evaluate is a navigation
          to the same route, which re-renders this server component but does NOT
          remount the client one, so without a key the builder would keep the
          state it had before the URL moved. The key makes the address the
          authority; the state it rebuilds is identical, because the address was
          written from it. */}
      <TradeBuilder
        key={`${decoded.proposal?.theirRosterId ?? "none"}|${proposalParams.in ?? ""}|${proposalParams.out ?? ""}`}
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
        source={sourceSlug}
        myRosterId={myRosterId}
        teams={teams}
        isDynasty={finderLeague.isDynasty}
        allowPicks={finderLeague.allowPicks}
        initialProposal={decoded.proposal}
      />

      {/* Always rendered, and the shell of it renders OUTSIDE the Suspense
          boundary on purpose. `#trade-evaluation` has to be a real element at
          first paint: put inside the boundary it would not exist when the
          browser went looking for it, and the jump from the Evaluate button
          would land nowhere. Present with nothing in it, it also tells a reader
          arriving on an empty builder where the answer is going to appear.
          tabIndex -1 makes it a focus target without adding it to the tab
          order. */}
      <section
        id="trade-evaluation"
        tabIndex={-1}
        aria-labelledby="trade-evaluation-title"
        className="scroll-mt-24 rounded-modal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <h2 id="trade-evaluation-title" className="sr-only">
          Trade evaluation
        </h2>
        {decoded.droppedTokens > 0 && (
          <p className="mb-3 rounded-card border border-line bg-surface p-3 text-sm leading-relaxed text-ink-muted">
            This link was partial.{" "}
            {decoded.droppedTokens === 1
              ? "One piece of it"
              : `${decoded.droppedTokens} pieces of it`}{" "}
            could not be read, so the trade below is smaller than the one that was
            shared with you.
          </p>
        )}
        {decoded.proposal === null ? (
          <EvaluationState kind="empty" />
        ) : (
          <Suspense fallback={<EvaluationState kind="loading" />}>
            <ProposalEvaluation
              sleeperLeagueId={sleeperLeagueId}
              leagueRowId={leagueRowId}
              resynced={resynced}
              rosterParam={rosterParam}
              sourceSlug={sourceSlug}
              searchedUsername={searchedUsername}
              proposal={decoded.proposal}
              myTeamLabel={myTeam?.teamName ?? "Your team"}
              theirTeamLabel={theirTeam?.teamName ?? "The other team"}
              retryHref={retryHref}
              builderHref={emptyBuilderHref}
            />
          </Suspense>
        )}
      </section>
    </div>
  );
}

/**
 * Gates two and three, then the answer.
 *
 * Every failure is a state rendered in this slot, never a thrown response. A 429
 * for the whole document would take the masthead, the tabs, and the navigation
 * down with the one panel that could not be computed, and it would do it to a
 * reader who was using the feature exactly as intended.
 */
async function ProposalEvaluation({
  sleeperLeagueId,
  leagueRowId,
  resynced,
  rosterParam,
  sourceSlug,
  searchedUsername,
  proposal,
  myTeamLabel,
  theirTeamLabel,
  retryHref,
  builderHref,
}: {
  sleeperLeagueId: string;
  leagueRowId: string;
  resynced: boolean;
  rosterParam: number | null;
  sourceSlug: string | null;
  searchedUsername: string | null;
  proposal: TradeProposal;
  myTeamLabel: string;
  theirTeamLabel: string;
  retryHref: string;
  builderHref: string;
}) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  // The league the builder, the rail, and the identity resolution already read.
  // loadBuilderLeague is React-cached on primitives, so this is the same object
  // they got rather than a second identical query. Without handing it over,
  // validateProposal would re-read the whole finder league on every evaluated
  // request: same query, same answer, twice the work on the hot path.
  const finder = await loadBuilderLeague(
    sleeperLeagueId,
    leagueRowId,
    resynced,
    sourceSlug,
    searchedUsername,
    rosterParam,
  );

  // Gate 2. Ownership re-derived from the database. One league read, and on this
  // path it is a read the page has already made, handed over as `finder`.
  //
  // EVERYTHING FROM HERE CAN THROW, and on a server-rendered path an unhandled
  // throw escapes the Suspense boundary and replaces the whole document with the
  // error page: masthead, tabs and navigation included. That is the outcome this
  // component exists to avoid, so the whole sequence sits in a try.
  let result: Awaited<ReturnType<typeof evaluateValidatedTrade>>;
  try {
    const validated = await validateProposal(supabase, adminClient, {
      sleeperLeagueId,
      sourceSlug,
      identity: { username: searchedUsername, rosterId: proposal.myRosterId },
      proposal,
      finder,
    });
    if (!validated.ok) {
      return (
        <EvaluationState
          kind="invalid-link"
          message={validated.error}
          retryHref={builderHref}
        />
      );
    }

    // Gate 3. The evaluation claim, now that we know the request is real. The
    // same bucket the server action claims from, so alternating between the two
    // cannot buy a second budget. The expensive read happens INSIDE
    // evaluateValidatedTrade, behind this line.
    const allowed = await claimTradeEvaluationSlot();
    if (!allowed) {
      return <EvaluationState kind="rate-limited" retryHref={retryHref} />;
    }

    result = await evaluateValidatedTrade(supabase, adminClient, validated.validated);
  } catch (err) {
    console.error("[trade-ideas] server-rendered evaluation failed", err);
    return <EvaluationState kind="error" retryHref={retryHref} />;
  }

  if (!result.ok) {
    return <EvaluationState kind="error" message={result.error} retryHref={retryHref} />;
  }

  return (
    <TradeVerdict
      impact={result.impact}
      myTeamLabel={myTeamLabel}
      theirTeamLabel={theirTeamLabel}
    />
  );
}

/**
 * Where your team stands, in the rail beside the evaluation.
 *
 * Reads the same league the builder does, through the request-scoped cache, so
 * the rail costs one extra query set (the Power Pulse view) rather than a second
 * read of every roster. Anything that view does not carry is passed as null and
 * the panel says "Not available" in words, because a zero in a rail full of real
 * figures reads as a measurement.
 */
async function YourTeamRail({
  sleeperLeagueId,
  leagueRowId,
  resynced,
  sourceSlug,
  formatConfigId,
  season,
  searchedUsername,
  rosterParam,
}: {
  sleeperLeagueId: string;
  leagueRowId: string;
  resynced: boolean;
  sourceSlug: string | null;
  formatConfigId: string | null;
  season: number | null;
  searchedUsername: string | null;
  rosterParam: number | null;
}) {
  const finderLeague = await loadBuilderLeague(
    sleeperLeagueId,
    leagueRowId,
    resynced,
    sourceSlug,
    searchedUsername,
    rosterParam,
  );
  if (!finderLeague || finderLeague.myRosterId === null) return null;

  const me = finderLeague.teams.find((t) => t.rosterId === finderLeague.myRosterId);
  if (!me) return null;

  const supabase = await createClient();
  const view =
    season === null
      ? null
      : await loadPowerPulseView(
          supabase,
          leagueRowId,
          season,
          formatConfigId,
          sourceSlug,
        );
  const pulse = view?.teams.find((t) => t.sleeperRosterId === me.rosterId) ?? null;

  // The lowest-scoring player in the optimal lineup: the slot a trade has the
  // most room to improve. Named by his position rather than by a slot token,
  // because the lineup fill records the player's position and inventing a slot
  // label for him would be a detail we did not compute.
  const weakest = (() => {
    const starters = pulse?.starters ?? [];
    if (starters.length === 0) return null;
    let worst = starters[0];
    for (const starter of starters) {
      if (starter.points < worst.points) worst = starter;
    }
    return { label: `${worst.position}, ${worst.name}`, points: worst.points };
  })();

  return (
    <YourTeamPanel
      teamName={me.teamName}
      pulseRank={me.pulseRank}
      pulseScore={pulse === null ? null : Math.round(pulse.powerPulse)}
      teamCount={finderLeague.teams.length}
      statusLabel={me.statusLabel}
      projectedWins={pulse?.projectedWins ?? null}
      projectedLosses={pulse?.projectedLosses ?? null}
      playoffOdds={pulse?.playoffOdds ?? null}
      valueRank={me.valueRank}
      weakestSlot={weakest}
    />
  );
}

/**
 * One input, one source. A dt/dd pair rather than a sentence, so the rail reads
 * as a reference and a screen reader gets the term before the value.
 */
function SourceLine({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="inline font-semibold text-ink">{term}: </dt>
      <dd className="inline">{detail}</dd>
    </div>
  );
}

/** What sits there while the league is being read. */
function FinderSkeleton() {
  return (
    <Panel eyebrow="Working" title="Reading every roster in this league">
      <p className="text-sm text-ink-muted">This takes a moment.</p>
    </Panel>
  );
}

/** The same wait, named for what the builder is waiting on. */
function BuilderSkeleton() {
  return (
    <Panel eyebrow="Working" title="Loading every roster you can trade with">
      <p className="text-sm text-ink-muted">This takes a moment.</p>
    </Panel>
  );
}

function YourTeamSkeleton() {
  return (
    <Panel eyebrow="Your team" title="Reading your standing">
      <p className="text-sm text-ink-muted">This takes a moment.</p>
    </Panel>
  );
}

/**
 * Which of these teams is yours?
 *
 * Every other deep-view surface can render without knowing, because they are
 * describing the league. This one cannot: a trade suggestion is advice to one
 * manager, and guessing would be advice to the wrong one. Arriving from My
 * Sleeper Leagues or from a search carries the handle and skips this entirely;
 * a cold link does not, so it asks once and remembers through the URL.
 */
function TeamChooser({
  teams,
  sleeperLeagueId,
  searchedUsername,
  mode,
}: {
  teams: { rosterId: number; teamName: string; ownerHandle: string | null }[];
  sleeperLeagueId: string;
  searchedUsername: string | null;
  /** Carried through the answer, so picking a team does not also switch tab. */
  mode?: TradeIdeasMode;
}) {
  return (
    <Panel eyebrow="First" title="Which team is yours?">
      <p className="text-sm leading-relaxed text-ink-muted">
        Offers are built for one manager, so we need to know which one.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {teams.map((team) => {
          const qs = new URLSearchParams({ roster: String(team.rosterId) });
          if (mode) qs.set("mode", mode);
          if (searchedUsername) qs.set("username", searchedUsername);
          return (
            <li key={team.rosterId}>
              <Link
                href={`/leagues/${sleeperLeagueId}/trade-ideas?${qs.toString()}`}
                className="flex min-h-11 items-center rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {/* teamName already pairs the name with the handle, so this
                    is one line rather than two. */}
                <span>{team.teamName}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function formatRelative(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
