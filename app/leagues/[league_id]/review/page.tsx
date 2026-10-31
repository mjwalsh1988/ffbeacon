import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { LEAGUE_CORE_COLUMNS, pulseLeagueCore } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { leagueMastheadProps } from "@/lib/league-masthead";
import { loadViewerCandidates } from "@/lib/league-positional-war-data";
import { matchViewerRoster } from "@/lib/league-viewer";
import { loadRosters } from "@/lib/power-pulse/load";
import type { LineupTeamOption } from "@/lib/league-lineups/types";
import type { SleeperLeague } from "@/lib/sleeper";
import { findReviewsInProgress } from "@/lib/commerce/orders";
import { loadOfferState, tierOf } from "@/lib/commerce/offer";
import { LeagueShell } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { withUsername } from "@/components/league-schedule/format";
import { Sheet } from "@/components/league-blueprint/sheet";
import { CheckoutForm } from "@/components/commerce/checkout-form";
import { TierCardStatic } from "@/components/commerce/tier-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Personal Team Review",
  description: "Michael reads one team in your league and writes to you.",
  robots: { index: false, follow: true },
};

const FAMILY = "team-review";
const TITLE_ID = "checkout-title";

/**
 * The checkout, inside the league shell with the Blueprint tab active. Reached from
 * the offers, so it is not in LEAGUE_NAV_ITEMS. Nothing here prices anything: the
 * form shows the product's price and `createOrderAction` computes its own.
 */
const getSyncedLeague = cache(async (sleeperLeagueId: string) => {
  const pulse = await pulseLeagueCore(createAdminClient(), sleeperLeagueId);
  if (!pulse.ok) return null;
  const league =
    pulse.league ??
    (
      await (await createClient())
        .from("leagues")
        .select(LEAGUE_CORE_COLUMNS)
        .eq("sleeper_league_id", sleeperLeagueId)
        .maybeSingle()
    ).data;
  return league ? { league, cached: pulse.cached } : null;
});

function rosterParam(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

const loadTeams = cache(async (leagueRowId: string): Promise<LineupTeamOption[]> => {
  const rosters = await loadRosters(createAdminClient(), leagueRowId);
  return rosters
    .map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      rosterRowId: r.id,
      teamName: r.teamName,
      ownerHandle: r.ownerHandle,
      record: { wins: r.wins, losses: r.losses, ties: r.ties },
    }))
    .sort((a, b) => a.sleeperRosterId - b.sleeperRosterId);
});

function SheetHead({ blurb }: { blurb: string }) {
  return (
    <header className="px-5 pb-6 pt-7 sm:px-8 sm:pt-8">
      <p className="flex items-center gap-2.5">
        {/* The site's own mark, decorative: the words beside it name the author. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/ff-beacon-mark-96.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" />
        <span className="text-sm font-semibold text-ink">FF Beacon</span>
        <span aria-hidden="true" className="h-3.5 w-px bg-line-accent" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Order form</span>
      </p>
      <h2 id={TITLE_ID} className="mt-5 text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
        Order a review
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{blurb}</p>
    </header>
  );
}

export default async function LeagueReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ roster?: string; tier?: string; username?: string; source?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,20}$/.test(sleeperLeagueId)) notFound();

  const synced = await getSyncedLeague(sleeperLeagueId);
  if (!synced) notFound();
  const { league, cached: pulseCached } = synced;

  const supabase = await createClient();
  const admin = createAdminClient();
  const viewer = await resolveSleeperViewer(supabase, sp.username);
  const linkUsername = viewerLinkUsername(viewer);

  const [
    { otherLeagues },
    resolvedSource,
    teams,
    candidates,
    offer,
    {
      data: { user },
    },
  ] = await Promise.all([
    loadLeagueHeaderActions(
      supabase,
      league.id,
      sleeperLeagueId,
      viewer,
      league.season != null ? String(league.season) : null,
    ),
    resolveSourceSlug(supabase, sp.source),
    loadTeams(league.id),
    loadViewerCandidates(supabase, league.id),
    loadOfferState(admin),
    supabase.auth.getUser(),
  ]);
  if (teams.length === 0) notFound();

  const requested = rosterParam(sp.roster);
  if (sp.roster !== undefined && (requested === null || !teams.some((t) => t.sleeperRosterId === requested))) {
    notFound();
  }
  const viewerRosterId = matchViewerRoster(candidates, viewer?.username ?? null, null, viewer?.sleeperUserId ?? null);
  const rosterId = requested ?? viewerRosterId ?? teams[0].sleeperRosterId;
  const team = teams.find((t) => t.sleeperRosterId === rosterId)!;

  const context = await resolveLeagueContext(
    admin,
    league.metadata as unknown as SleeperLeague,
    resolvedSource.slug,
  );

  const products = offer.products.filter((p) => p.family === FAMILY);
  const preselected =
    products.find((p) => tierOf(p) === sp.tier) ?? products[0] ?? null;
  const inProgress = user ? await findReviewsInProgress(supabase, sleeperLeagueId) : {};

  const canonical = `/leagues/${sleeperLeagueId}/review?roster=${rosterId}`;
  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = withUsername(`/leagues/${sleeperLeagueId}`, linkUsername);
  const blueprintHref = withUsername(`/leagues/${sleeperLeagueId}/blueprint?roster=${rosterId}`, linkUsername);

  const signInNext = `${canonical}${preselected ? `&tier=${tierOf(preselected)}` : ""}`;
  const availability = offer.availability;

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="blueprint"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[
        { label: league.name, href: leagueHref },
        { label: "Blueprint", href: blueprintHref },
        { label: "Personal Team Review" },
      ]}
      copyHref={canonical}
      copyAriaLabel={`Copy link to the review order page for ${team.teamName}`}
      otherLeagues={otherLeagues}
      masthead={{
        ...leagueMastheadProps(league, context, pulseCached),
        pageTitle: "Personal Team Review",
        pageDescription:
          "Michael reads one team in this league and writes to you. Pick the review, confirm the team, tell him what you want answered, and pay the way you like.",
      }}
    >
      {products.length === 0 || availability.reason === "closed" ? (
        <Panel eyebrow="Personal Team Review" title="Reviews are not on sale right now">
          <p className="text-sm leading-relaxed text-ink-muted">Check back shortly. The Blueprint stays free.</p>
        </Panel>
      ) : availability.reason === "fully_booked" ? (
        <div className="space-y-6">
          <Panel eyebrow="Personal Team Review" title="Fully booked">
            <p className="text-sm leading-relaxed text-ink-muted">{offer.settings.storefront.fullyBookedMessage}</p>
          </Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            {products.map((p) => (
              <TierCardStatic key={p.slug} product={p} />
            ))}
          </div>
        </div>
      ) : !user ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {products.map((p) => (
              <TierCardStatic key={p.slug} product={p} />
            ))}
          </div>
          <Panel eyebrow="Personal Team Review" title="Sign in to order">
            <p className="text-sm leading-relaxed text-ink-muted">
              Your review is delivered into My Beacon, so an account is where it lives.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(signInNext)}` as Route}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
            >
              Sign in to order
            </Link>
          </Panel>
        </div>
      ) : (
        <Sheet labelledBy={TITLE_ID}>
          <SheetHead blurb={`Written by Michael, by hand, for one team in ${league.name}. The Blueprint stays free; the review is the paid read on top of it.`} />
          <CheckoutForm
            sleeperLeagueId={sleeperLeagueId}
            leagueName={league.name}
            linkUsername={linkUsername}
            products={products}
            initialSlug={preselected?.slug ?? products[0].slug}
            teams={teams}
            initialRosterId={rosterId}
            methods={availability.methods}
            couponsEnabled={offer.settings.coupons.enabled}
            inProgress={inProgress}
            sourceSlug={resolvedSource.slug}
          />
        </Sheet>
      )}
    </LeagueShell>
  );
}
