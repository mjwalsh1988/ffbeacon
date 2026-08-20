import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import { Workflow, Sparkles, Lock, ArrowRight, Activity } from "lucide-react";
import { LeaguePulseForm } from "./league-pulse-form";
import { LeagueResults } from "./league-results";
import { ScrollToResults } from "./scroll-to-results";
import { StepRail } from "./step-rail";
import { getSleeperUser, getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";
import { createClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  loadSearchedTeamStatuses,
  type LeagueTeamStatusSummary,
} from "@/lib/league-team-status-data";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead, type MastheadStat } from "@/components/app-shell/page-masthead";
import { isDiscordMember } from "@/lib/discord-membership";

export const metadata: Metadata = {
  alternates: { canonical: "/tools/league-pulse" },
  title: "Sleeper League Pulse: All Your Leagues, One Page",
  description:
    "Type your Sleeper username and see every league you are in: real rosters, recent trades, and who is actually winning. No login needed to look around.",
  ...pageShareMetadata({
    key: "league-pulse",
    title: "Sleeper League Pulse: All Your Leagues, One Page",
    description:
      "Type your Sleeper username and see every league you are in: real rosters, recent trades, and who is actually winning. No login needed to look around.",
    path: "/tools/league-pulse",
  }),
};

export const dynamic = "force-dynamic";

export default async function LeaguePulsePage({
  searchParams,
}: {
  searchParams: Promise<{ username?: string; season?: string }>;
}) {
  const params = await searchParams;
  const usernameInput = params.username?.trim();
  const season = params.season?.trim() || currentNflSeason();

  // Logged-in state drives two things: hide the "sign in to save" CTA, and
  // pre-fill the search input with the saved Sleeper handle so the user never
  // has to paste it again.
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(authUser);

  let savedUsername = "";
  if (authUser) {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("sleeper_league_settings")
      .eq("user_id", authUser.id)
      .maybeSingle();
    savedUsername =
      parseSleeperLeagueSettings(prefs?.sleeper_league_settings).username ?? "";
  }

  // URL param wins (shareable links); otherwise fall back to the saved handle.
  const defaultUsername = usernameInput ?? savedUsername;

  // What we actually look up. A signed-in reader who has already told us their
  // handle should not have to press a button to be told what we already know,
  // so the saved handle searches itself. Typing a different one still wins,
  // because the URL param is checked first.
  const lookupUsername = defaultUsername.trim();
  // True only when the reader asked for this search. Drives the auto-scroll:
  // yanking someone down past the hero on a plain page visit, and moving their
  // focus while they are still reading the top of the page, is the opposite of
  // helpful.
  const searchWasRequested = Boolean(usernameInput);

  let user = null;
  let leagues: Awaited<ReturnType<typeof getSleeperLeagues>> = [];
  let error: string | null = null;

  // Where this user's own team stands in each league, for the leagues we have
  // already pulsed. Read-only: the entry point never syncs on render, so leagues
  // nobody has opened stay unsynced and say so, with a Sync button on the row
  // for a reader who wants the number without leaving the list.
  let teamStatuses: Record<string, LeagueTeamStatusSummary> = {};
  const resolvedSource = await resolveSourceSlug(supabase, undefined);

  if (lookupUsername) {
    user = await getSleeperUser(lookupUsername);
    if (!user) {
      error = searchWasRequested
        ? `No Sleeper user found for "${lookupUsername}".`
        : `We could not load your saved Sleeper handle, "${lookupUsername}". Sleeper may be down, or the account may have been renamed. Search below to try another.`;
    } else {
      leagues = await getSleeperLeagues(user.user_id, season);
      if (leagues.length > 0) {
        const statusMap = await loadSearchedTeamStatuses(
          supabase,
          leagues.map((l) => l.league_id),
          user.user_id,
          Number(season),
          resolvedSource.slug,
        );
        teamStatuses = Object.fromEntries(statusMap);
      }
    }
  }

  // Drive the lookup step rail: once a valid user resolved (leagues below), the
  // flow has advanced to "choose a league". A failed lookup stays on step 1.
  const currentStep: 1 | 2 | 3 = user ? 2 : 1;

  // Confirmed Discord members skip the invite: the hero button scrolls them
  // down to the lookup form, and the bottom CTA points at the rest of the tools.
  const isMember = await isDiscordMember();

  // Numbers the masthead can show without inventing any: the season we are
  // looking at, and how many leagues the current lookup actually returned.
  const mastheadStats: MastheadStat[] = [
    { label: "Season", value: season, accent: "cyan" },
  ];
  if (user) {
    mastheadStats.push({
      label: "Leagues",
      value: String(leagues.length),
      accent: "purple",
    });
  }

  return (
    <main id="main">
      <PageBody>
        <Masthead isMember={isMember} stats={mastheadStats} />
        <section
          id="league-pulse-connect"
          aria-labelledby="sync-heading"
          className="mt-8 scroll-mt-24"
        >
          {/* Contained lookup shell: the form lives inside a centered cockpit
              card (icon badge, step rail, glow wash) so the entry experience
              reads as a guided wizard, matching On The Clock. */}
          <div className="mx-auto max-w-3xl">
            <div
              className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
              }}
            >
              {/* Beacon-gradient accent bar pinned to the top of the shell. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
                }}
              />
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
                >
                  <Activity className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                    League lookup
                  </p>
                  <h2
                    id="sync-heading"
                    className="text-lg font-semibold tracking-tight text-ink sm:text-xl"
                  >
                    Connect your Sleeper account
                  </h2>
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Paste your Sleeper handle and pick a season. We hit Sleeper
                directly and return every active league for that user, no
                account required.
              </p>

              <div className="mt-6">
                <StepRail current={currentStep} />
              </div>
              <div className="mt-5">
                <LeaguePulseForm
                  defaultUsername={defaultUsername}
                  defaultSeason={season}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-5 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>

        {user && (
          <section
            id="league-results"
            aria-labelledby="results-heading"
            className="scroll-mt-4"
          >
            {searchWasRequested && (
              <ScrollToResults
                key={`${user.user_id}-${season}`}
                targetId="league-results"
                headingId="results-heading"
              />
            )}
            <div className="pt-10 sm:pt-12">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SectionEyebrow>Your leagues</SectionEyebrow>
                  <h2
                    id="results-heading"
                    className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
                  >
                    {leagues.length}{" "}
                    {leagues.length === 1 ? "league" : "leagues"} for{" "}
                    <span className="text-brand-cyan">{user.display_name}</span>
                  </h2>
                  <p className="mt-2 text-sm text-ink-muted">
                    {season} season. Sourced live from Sleeper.
                  </p>
                </div>
              </div>

              {leagues.length === 0 ? (
                <div className="mt-6 flex items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
                  >
                    <Workflow className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-ink">
                      No active leagues for {season}.
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      Double-check the season above, or try the previous year if
                      you&apos;re looking at off-season state.
                    </p>
                  </div>
                </div>
              ) : (
                <LeagueResults
                  leagues={leagues}
                  season={season}
                  sleeperUsername={user.display_name ?? lookupUsername ?? null}
                  teamStatuses={teamStatuses}
                  sourceSlug={resolvedSource.slug}
                />
              )}
            </div>
          </section>
        )}

        {!isLoggedIn && <CtaSection />}
      </PageBody>
      <DiscordCtaSection
        eyebrow="Need a hand with your league?"
        heading="Questions about your league? Ask a real person."
        body="Confused by a power ranking or an odd Sleeper setting? Drop into our Discord and a real fantasy player will help you sort it out, free. Curious what else drives FF Beacon? Read about the project."
        isMember={isMember}
        memberHeading="League loaded. Explore the rest of the toolkit."
        memberBody="You're already in the crew, so we'll skip the invite. Take the other free FF Beacon tools for a spin to get even more out of your leagues."
      />
    </main>
  );
}

/* ---------- Masthead ---------- */

function Masthead({
  isMember,
  stats,
}: {
  isMember: boolean;
  stats: MastheadStat[];
}) {
  return (
    <PageMasthead
      eyebrow="Tools"
      title="Every Sleeper league you own, in one accessible table."
      stats={stats}
      description={
        <>
          Drop in your Sleeper username and we&apos;ll pull every active
          league (roster shape, season, status) right from the source. No
          account required for this view.{" "}
          <Link
            href="/my-beacon/sleeper-leagues"
            className="text-brand-purple underline-offset-4 hover:underline"
          >
            Sign in to save your username
          </Link>{" "}
          and load it instantly each visit.
        </>
      }
      actions={
        <>
          <MemberHeroCta
            isMember={isMember}
            size="lg"
            memberMode="scroll"
            memberScrollTargetId="league-pulse-connect"
            memberLabel="Find your leagues"
            memberIcon="arrow-down"
          />
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            View player rankings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </>
      }
    >
      <ul
        role="list"
        aria-label="What this tool does"
        // Three across at every width. On a phone they stack down as three
        // full cards, which is a screen of marketing between the hero and the
        // search box, so there they compress to icon and title on one line and
        // the supporting line goes screen-reader-only. It is still announced,
        // and it comes back into view from sm up.
        className="grid grid-cols-3 gap-2 sm:gap-4"
      >
        <HeroBullet
          icon={Sparkles}
          title="Live data"
          body="Hits Sleeper on every search, no stale cache."
        />
        <HeroBullet
          icon={Workflow}
          title="One click open"
          body="Open any league for rosters, transactions, and power rankings."
        />
        <HeroBullet
          icon={Lock}
          title="No tracking"
          body="Your username is never stored unless you sign in to save it."
        />
      </ul>
    </PageMasthead>
  );
}

function HeroBullet({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Workflow;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line bg-surface/60 p-2.5 text-center sm:p-4 sm:text-left">
      <span
        aria-hidden="true"
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-card border border-line bg-base text-brand-cyan sm:mx-0"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2 text-[11px] font-semibold leading-tight text-ink sm:mt-3 sm:text-sm">
        {title}
      </p>
      {/* sr-only rather than hidden. The line is not worth a third of a phone
          screen, but it is still the sentence that explains the title, so a
          screen reader hears it at every width and it reappears from sm up. */}
      <p className="sr-only sm:not-sr-only sm:mt-1 sm:text-xs sm:leading-relaxed sm:text-ink-muted">
        {body}
      </p>
    </li>
  );
}

/* ---------- CTA ---------- */

function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="pt-12 sm:pt-16">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-6 sm:p-8"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
          }}
        >
          <SectionEyebrow>Save the hassle</SectionEyebrow>
          <h2
            id="cta-heading"
            className="mt-2 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Sign in once, never paste your username again.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            Linked Sleeper handles auto-load on visit. Your default format and
            data source travel with you, too.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/my-beacon/sleeper-leagues"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Open My Beacon
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in or create account
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Shared ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
