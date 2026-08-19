import type { Metadata } from "next";
import { Suspense } from "react";
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
import { loadTradeFinderLeague } from "@/lib/trade-finder-data";
import { loadDeclinedKeys } from "@/lib/trade-finder-declines";
import { findTrades } from "@/lib/trade-finder/engine";
import { gradeSuggestions } from "@/lib/trade-finder-grade";
import { loadSavedKeys } from "@/lib/trade-finder-saves";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";

/**
 * Suggestions handed to the client on first paint.
 *
 * Matches the search action's window, so the tab opens with the same amount of
 * ranking behind the arrows that a Search press would hand back.
 */
const INITIAL_WINDOW = 12;

export const dynamic = "force-dynamic";

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

  const title = `${league.name} Trade Finder`;
  const description = `Trades worth offering in ${league.name}, one at a time, with what each one does to your starting lineup.`;
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
  searchParams: Promise<{ source?: string; username?: string; roster?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
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
      activeTab="trade-finder"
      searchedUsername={searchedUsername}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Trade Finder" }]}
      copyHref={`/leagues/${sleeperLeagueId}/trade-finder`}
      copyAriaLabel="Copy link to this league's Trade Finder"
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
            Trade Finder
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            One trade at a time, built from what every roster in this league
            needs.
          </p>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {/* The intro strip above owns an h2, so the working area needs one
                of its own rather than opening on an h3 inside the card. */}
            <h2 className="sr-only">Suggested trade</h2>
            {/* Streamed. Reading a league is a couple of seconds of rosters,
                values, and projections, and holding the whole page on it would
                mean the tabs and the league identity arrive at the same time as
                the deal. The header paints first and this fills in behind it,
                matching how the Overview tab streams its rankings. */}
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
          </div>

          {/* Sources, not a lesson. Each line names one input and stops; the
              reasoning behind them belongs in the docs, not in a rail the
              reader passes every time they open the tab. */}
          <aside
            aria-label="Where the numbers come from"
            className="xl:sticky xl:top-[5.5rem] xl:self-start"
          >
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
  const supabase = await createClient();
  const adminClient = createAdminClient();

  // The engine reads transaction history and the Power Pulse cache, so the
  // derived half has to have run. It waits here rather than in the shell.
  await pulseLeagueDerived(adminClient, leagueRowId, { resynced });

  const finderLeague = await loadTradeFinderLeague(supabase, {
    sleeperLeagueId,
    sourceSlug,
    identity: { username: searchedUsername, rosterId: rosterParam },
  });

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
  const myPlayers: PlayerOption[] = [];
  const theirPlayers: PlayerOption[] = [];
  for (const team of finderLeague.teams) {
    for (const p of team.players) {
      if (!p.hasValue) continue;
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

  return (
    <TradeFinder
      mode="league"
      isSignedIn={isSignedIn}
      sleeperLeagueId={sleeperLeagueId}
      searchedUsername={searchedUsername}
      source={sourceSlug}
      myPlayers={myPlayers}
      theirPlayers={theirPlayers}
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
}: {
  teams: { rosterId: number; teamName: string; ownerHandle: string | null }[];
  sleeperLeagueId: string;
  searchedUsername: string | null;
}) {
  return (
    <Panel eyebrow="First" title="Which team is yours?">
      <p className="text-sm leading-relaxed text-ink-muted">
        Offers are built for one manager, so we need to know which one.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {teams.map((team) => {
          const qs = new URLSearchParams({ roster: String(team.rosterId) });
          if (searchedUsername) qs.set("username", searchedUsername);
          return (
            <li key={team.rosterId}>
              <Link
                href={`/leagues/${sleeperLeagueId}/trade-finder?${qs.toString()}`}
                className="flex min-h-11 items-center rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span>
                  {team.teamName}
                  {team.ownerHandle && team.ownerHandle !== team.teamName && (
                    <span className="block text-xs font-normal text-ink-muted">
                      {team.ownerHandle}
                    </span>
                  )}
                </span>
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
