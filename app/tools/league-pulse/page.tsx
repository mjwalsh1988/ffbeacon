import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import { Workflow, Sparkles, Lock, ArrowRight, Activity } from "lucide-react";
import { LeagueResults } from "./league-results";
import { PulseHandleGate } from "./pulse-handle-gate";
import { ScrollToResults } from "./scroll-to-results";
import { StepRail } from "./step-rail";
import {
  getSleeperUser,
  getSleeperLeagues,
  currentNflSeason,
} from "@/lib/sleeper";
import { createClient } from "@/lib/supabase/server";
import {
  resolveHandleGate,
  resolveSleeperViewer,
} from "@/lib/sleeper-handle/resolve";
import { gateViewer } from "@/lib/sleeper-handle/types";
import { deriveStatusVariant } from "@/lib/sleeper-to-format";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  loadSearchedTeamStatuses,
  type LeagueTeamStatusSummary,
} from "@/lib/league-team-status-data";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
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

  const supabase = await createClient();

  // D1: one resolver. This page does not read the saved handle out of the
  // preferences jsonb itself; the gate decides which of the four states it is
  // in (guest, member-unsaved, member-saved, member-overridden) and everything
  // below reads off that.
  // D3, the pre-0268 backfill, happens INSIDE the resolver and not here.
  // `resolveHandleGate` fills a missing Sleeper user id through the same
  // metered, memoized path the ten league deep views use. Repeating it here
  // was a second `getSleeperUser` in the same render whenever the first one
  // failed, on a page that is force-dynamic and has no boundary in front of
  // it, and the lookup further down would then make a third.
  const gate = await resolveHandleGate(supabase, params.username);

  // D2: the URL wins, then the saved handle, then nothing. `gateViewer` answers
  // that for the two states carrying an identity; a signed-out reader following
  // a shareable link is the remaining case, and it is the resolver's to answer.
  // Both reads are memoized per request, so this costs no extra query.
  const viewer =
    gateViewer(gate) ?? (await resolveSleeperViewer(supabase, params.username));

  // Drives the "sign in to save" copy and the bottom CTA, nothing else.
  const isLoggedIn = gate.kind !== "guest";

  // What we actually look up. A signed-in reader who has already told us their
  // handle should not have to press a button to be told what we already know,
  // so the saved handle searches itself. A link naming someone else still wins,
  // because the URL param is checked first.
  const lookupUsername = viewer?.username ?? "";
  // True only when the reader asked for this search. Drives the auto-scroll:
  // yanking someone down past the hero on a plain page visit, and moving their
  // focus while they are still reading the top of the page, is the opposite of
  // helpful. Tied to the URL param alone, so an auto-run never scrolls.
  const searchWasRequested = Boolean(usernameInput);

  // The saved identity already carries these for a reader who saved one, which
  // is what lets the lookup below be a single Sleeper call.
  let sleeperUserId = viewer?.sleeperUserId ?? null;
  let sleeperDisplayName = viewer?.displayName ?? null;
  let leagues: Awaited<ReturnType<typeof getSleeperLeagues>> = [];
  let error: string | null = null;

  // Where this user's own team stands in each league, for the leagues we have
  // already pulsed. Read-only: the entry point never syncs on render, so leagues
  // nobody has opened stay unsynced and say so, with a Sync button on the row
  // for a reader who wants the number without leaving the list.
  let teamStatuses: Record<string, LeagueTeamStatusSummary> = {};
  const resolvedSource = await resolveSourceSlug(supabase, undefined);

  if (lookupUsername) {
    // D3: with the cached id in hand this is ONE Sleeper call, not two. A
    // Sleeper user id never changes, so it stays correct even for a reader who
    // renamed themselves after saving.
    if (!sleeperUserId) {
      const user = await getSleeperUser(lookupUsername);
      if (user) {
        sleeperUserId = user.user_id;
        sleeperDisplayName = user.display_name ?? null;
      }
    }

    if (!sleeperUserId) {
      error = searchWasRequested
        ? `No Sleeper user found for "${lookupUsername}".`
        : `We could not load your saved Sleeper handle, "${lookupUsername}". Sleeper may be down, or the account may have been renamed. Search below to try another.`;
    } else {
      leagues = await getSleeperLeagues(sleeperUserId, season);
      if (leagues.length > 0) {
        const statusMap = await loadSearchedTeamStatuses(
          supabase,
          leagues.map((l) => l.league_id),
          sleeperUserId,
          Number(season),
          resolvedSource.slug,
          // Redraft rooms get the redraft wording on their tag. Read off the
          // Sleeper payload we already have rather than our own table.
          Object.fromEntries(
            leagues.map((l) => [l.league_id, deriveStatusVariant(l)]),
          ),
        );
        teamStatuses = Object.fromEntries(statusMap);
      }
    }
  }

  // Who the results are for, in the wording a reader recognises. The display
  // name and the username are different strings on Sleeper, so the fallback
  // matters rather than being defensive noise.
  const viewerLabel = sleeperDisplayName ?? lookupUsername;

  // Drive the lookup step rail: once a valid user resolved (leagues below), the
  // flow has advanced to "choose a league". A failed lookup stays on step 1.
  // A reader with a saved handle therefore lands on step 2 on arrival, because
  // their auto-run already answered step 1 for them.
  const currentStep: 1 | 2 | 3 = sleeperUserId ? 2 : 1;

  // The card is on screen for these two states, so it carries the "your saved
  // handle no longer resolves" sentence and opens its own form (D3). The page
  // does not also print it underneath: one failure, said once.
  const savedHandleFailed =
    gate.kind === "member-saved" && Boolean(lookupUsername) && !sleeperUserId;
  const pageError = savedHandleFailed ? null : error;

  // A reader with a handle on file has already done the connecting, so the
  // cockpit around the card (icon badge, eyebrow, blurb, step rail, panel
  // padding) is a screen of scaffolding explaining a step they finished on a
  // previous visit. It costs roughly 300px of the first screen, which is
  // exactly the space their leagues wanted. So the two card states collapse to
  // the card alone, and only the states that still need the guided form keep
  // the cockpit.
  const showsIdentityCard =
    gate.kind === "member-saved" || gate.kind === "member-overridden";

  // Confirmed Discord members skip the invite: the hero button scrolls them
  // down to the lookup form, and the bottom CTA points at the rest of the tools.
  const isMember = await isDiscordMember();

  return (
    <main id="main">
      <PageBody>
        {/* The "sign in to save" sentence is only true for a reader who has
            nothing saved. Saying it to someone whose handle is already on file
            sends them to a page to do a thing they did. */}
        <Masthead isMember={isMember} showSaveHint={!showsIdentityCard} />
        <section
          id="league-pulse-connect"
          aria-labelledby="sync-heading"
          className={
            showsIdentityCard ? "mt-4 scroll-mt-24" : "mt-8 scroll-mt-24"
          }
        >
          {showsIdentityCard ? (
            // The card alone, at full container width so it lines up with the
            // league table under it and reads as that table's status line. It
            // is also the shortest arrangement: the narrow cockpit column made
            // the heading wrap on a phone.
            <div>
              {/* The section is aria-labelledby this, and the card's own h3
                  already names the state on screen, so the visible h2 would be
                  the same sentence twice. sr-only rather than deleted: the
                  label has to resolve to a real node, and the document outline
                  still needs the h2 above the card's h3. */}
              <h2 id="sync-heading" className="sr-only">
                Your Sleeper account
              </h2>
              <PulseHandleGate
                state={gate}
                defaultUsername={lookupUsername}
                defaultSeason={season}
                status={savedHandleFailed ? "failed" : "idle"}
                statusMessage={savedHandleFailed ? error : null}
                clearHref={`/tools/league-pulse?season=${encodeURIComponent(season)}`}
                compact
              />
              {pageError && (
                <p
                  role="alert"
                  className="mt-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
                >
                  {pageError}
                </p>
              )}
            </div>
          ) : (
            /* Contained lookup shell: the form lives inside a centered cockpit
               card (icon badge, step rail, glow wash) so the entry experience
               reads as a guided wizard, matching On The Clock. A reader with
               nothing on file still has the whole lookup to do, so this stays
               exactly as it was. */
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
                    {/* Only ever rendered for a reader with no handle on file,
                      so it asks for one. The saved states carry their own
                      sr-only h2 above the card instead. */}
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
                  <PulseHandleGate
                    state={gate}
                    defaultUsername={lookupUsername}
                    defaultSeason={season}
                    status={savedHandleFailed ? "failed" : "idle"}
                    statusMessage={savedHandleFailed ? error : null}
                    // Dropping the param is what hands the page back to the saved
                    // handle, so the way out of a shared link is a plain link.
                    clearHref={`/tools/league-pulse?season=${encodeURIComponent(season)}`}
                  />
                </div>

                {pageError && (
                  <p
                    role="alert"
                    className="mt-5 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
                  >
                    {pageError}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {sleeperUserId && (
          <section
            id="league-results"
            aria-labelledby="results-heading"
            className="scroll-mt-4"
          >
            {searchWasRequested && (
              <ScrollToResults
                key={`${sleeperUserId}-${season}`}
                targetId="league-results"
                headingId="results-heading"
              />
            )}
            {/* A reader who arrived with their handle already on file did not
                ask for a lookup, so there is no lookup to put distance from.
                The gap that separates a search from its results is just the
                distance between them and their leagues. */}
            <div
              className={showsIdentityCard ? "pt-5 sm:pt-6" : "pt-10 sm:pt-12"}
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SectionEyebrow>Your leagues</SectionEyebrow>
                  <h2
                    id="results-heading"
                    className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
                  >
                    {leagues.length}{" "}
                    {leagues.length === 1 ? "league" : "leagues"} for{" "}
                    <span className="text-brand-cyan">{viewerLabel}</span>
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
                  sleeperUsername={viewerLabel || null}
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
  showSaveHint,
}: {
  isMember: boolean;
  /** False once a handle is on file: the pitch has already been taken up. */
  showSaveHint: boolean;
}) {
  return (
    <PageMasthead
      eyebrow="Tools"
      title="Every Sleeper league you own, in one accessible table."
      description={
        <>
          Drop in your Sleeper username and we&apos;ll pull every active league
          (roster shape, season, status) right from the source. No account
          required for this view.
          {showSaveHint && (
            <>
              {" "}
              <Link
                href="/my-beacon/sleeper-leagues"
                className="text-brand-purple underline-offset-4 hover:underline"
              >
                Sign in to save your username
              </Link>{" "}
              and load it instantly each visit.
            </>
          )}
        </>
      }
      actions={
        <>
          {/* Short labels on purpose: the hero shows two of these three buttons
              at once, and the longer wording pushed the pair onto two rows at
              phone width. */}
          <MemberHeroCta
            isMember={isMember}
            size="lg"
            memberMode="scroll"
            memberScrollTargetId="league-pulse-connect"
            memberLabel="Pulse Leagues"
            memberIcon="arrow-down"
            joinLabel="Join Discord"
          />
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Player Rankings
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
