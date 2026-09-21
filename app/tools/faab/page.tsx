import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  resolveSourceForFormat,
  getAvailableSources,
  describeSource,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { loadFaabSettings } from "@/lib/faab/settings";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import {
  resolveHandleGate,
  resolveSleeperViewer,
} from "@/lib/sleeper-handle/resolve";
import { loadFaabPlayerListCached } from "@/lib/faab/player-list";
import { FaabForm, type FaabPlayer } from "./faab-form";
import { parseManualSeed } from "./manual-setup";
import { WrittenSections } from "./written-sections";
import { MarketStats, loadMarketFacts } from "./market-stats";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead, type MastheadChip } from "@/components/app-shell/page-masthead";
import { isDiscordMember } from "@/lib/discord-membership";

const META_TITLE = "FAAB Calculator for Fantasy Football: What to Bid";
const META_DESCRIPTION =
  "Free FAAB calculator: how much to bid on any waiver claim, your chance to win it, and when to walk away. Chopped and guillotine leagues too.";

export const metadata: Metadata = {
  alternates: { canonical: "/tools/faab" },
  title: META_TITLE,
  description: META_DESCRIPTION,
  ...pageShareMetadata({
    key: "faab",
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: "/tools/faab",
  }),
};

export const dynamic = "force-dynamic";

/**
 * Seasons the optional league panel offers.
 *
 * Derived here rather than in the browser so the list is identical in the
 * server render and the client one. Read in America/New_York, per the site-wide
 * time rule, so a January 1st visitor in Hawaii and the UTC server agree on
 * which season it is.
 */
function seasonOptions(): string[] {
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SITE_TIME_ZONE,
      year: "numeric",
    }).format(new Date()),
  );
  return [String(year), String(year - 1)];
}

export default async function FaabPage({
  searchParams,
}: {
  searchParams: Promise<{
    format?: string;
    source?: string;
    /** Shareable-link override (D2). Wins over the reader's saved handle. */
    username?: string | string[];
    /**
     * Manual setup, for a guide that links a reader into their own
     * situation: the league type and, for a chopped league, the field it
     * started with, the field still alive and how close to the cut they are.
     * Parsed strictly by `parseManualSeed`; anything unexpected is ignored.
     */
    kind?: string | string[];
    start?: string | string[];
    alive?: string | string[];
    danger?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const manualSeed = parseManualSeed(params);
  const supabase = await createClient();
  // Settings are service-role-only (RLS); read them server-side with the admin
  // client, same as Signal Check. loadFaabSettings never throws and falls back
  // to safe code defaults, so the calculator renders even if the row is absent.
  // The three are independent, so resolve them in parallel.
  const [settings, formatResolution, sourceResolution] = await Promise.all([
    loadFaabSettings(createAdminClient()),
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
  ]);
  const formatSlug = formatResolution.slug;
  const requestedSourceSlug = sourceResolution.slug;

  // These are independent of each other, so they go together rather than in a
  // waterfall: the format lookup, the source registry, who the league panel is
  // acting for, the reader's Discord membership, and the market cells behind
  // the "what leagues actually pay" section. The market read is cached daily
  // and shared with the FAQ, which quotes it.
  const [{ data: format }, registry, handleGate, urlViewer, isMember, marketFacts] =
    await Promise.all([
    supabase
      .from("format_configs")
      .select("id, slug, display_name")
      .eq("slug", formatSlug)
      .maybeSingle(),
    getAvailableSources(supabase),
    resolveHandleGate(supabase, params.username),
    // The gate answers "guest" for a signed-out reader without ever consulting
    // the URL, so on its own a shared `?username=` link would do nothing for
    // the readers most likely to be following one. This is the same
    // fall-through League Pulse uses, and both reads are memoized per request.
    resolveSleeperViewer(supabase, params.username),
    isDiscordMember(),
    loadMarketFacts(settings.priors.minCellSamples),
  ]);

  let players: FaabPlayer[] = [];
  let fallbackBanner: { requested: string | null; actual: string } | null = null;
  let rankingsSourceName: string | null = null;
  // The slug, not the display name: the league panel passes it back to the
  // server to look up who is actually available in the selected league.
  let rankingsSourceSlug: string | null = null;
  let valueSourceName: string | null = null;
  let valueSourceIsBeacon = false;
  if (format) {
    const rankingsResolution = resolveSourceForFormat(
      registry,
      "rankings",
      format.slug,
      requestedSourceSlug,
    );
    const valueHistoryResolution = resolveSourceForFormat(
      registry,
      "player_value_history",
      format.slug,
      requestedSourceSlug,
    );
    if (rankingsResolution.source) {
      rankingsSourceName = describeSource(registry, rankingsResolution.source);
      rankingsSourceSlug = rankingsResolution.source;
    }
    if (valueHistoryResolution.source) {
      valueSourceName = describeSource(registry, valueHistoryResolution.source);
      valueSourceIsBeacon = valueHistoryResolution.source === "ffbeacon";
    }
    if (rankingsResolution.fellBack && rankingsResolution.source) {
      fallbackBanner = {
        requested: describeSource(registry, rankingsResolution.requested),
        actual: describeSource(registry, rankingsResolution.source),
      };
    }

    if (rankingsResolution.source) {
      // One cached read for the whole list. The result is identical for every
      // visitor on this (format, rankings source, value source) and the data
      // behind it changes at most nightly.
      players = await loadFaabPlayerListCached({
        formatConfigId: format.id,
        rankingsSource: rankingsResolution.source,
        valueSource: valueHistoryResolution.source ?? null,
      });
    }
  }

  // Masthead context, all of it resolved above: the format these bids are
  // priced in, the value source behind them, and the size of the player pool.
  const mastheadChips: MastheadChip[] = [];
  if (format?.display_name) {
    mastheadChips.push({ label: format.display_name, tone: "cyan" });
  }
  if (valueSourceName) {
    mastheadChips.push({ label: `Values via ${valueSourceName}`, tone: "purple" });
  }
  const webApplicationLd = webApplicationJsonLd({
    name: META_TITLE,
    description: META_DESCRIPTION,
    url: "/tools/faab",
    category: "SportsApplication",
  });

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(webApplicationLd) }}
      />
      <PageBody width="tool">
        {fallbackBanner && (
          <p
            role="status"
            className="mb-4 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
          >
            <span className="font-medium text-ink">Heads up:</span> No{" "}
            {fallbackBanner.requested} data available for{" "}
            {format?.display_name ?? "this format"}. Showing {fallbackBanner.actual} data instead.
          </p>
        )}
        <FaabForm
          masthead={
          <PageMasthead
            eyebrow="Tools"
            title="Fantasy Football FAAB Calculator"
            description="What to bid, your chance to win, and when to walk away. Connect your Sleeper league, chopped leagues included, or enter your setup by hand."
            chips={mastheadChips}
            actions={
              <>
                {/* Short labels on purpose: the hero shows two of these three
                    buttons at once, and the longer wording pushed the pair onto
                    two rows at phone width. */}
                <MemberHeroCta
                  isMember={isMember}
                  size="lg"
                  memberMode="scroll"
                  memberScrollTargetId="faab-form-section"
                  memberLabel="Get Bids"
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
          />
          }
          players={players}
          formatName={format?.display_name ?? "default format"}
          rankingsSourceName={rankingsSourceName}
          valueSourceName={valueSourceName}
          valueSourceIsBeacon={valueSourceIsBeacon}
          settings={settings}
          seasons={seasonOptions()}
          formatSlug={format?.slug ?? formatSlug}
          rankingsSourceSlug={rankingsSourceSlug}
          handleGate={handleGate}
          urlViewer={urlViewer}
          seed={manualSeed}
        />
        <p className="mt-8 text-sm leading-relaxed text-ink-muted">
          Curious what these bids are actually built from?{" "}
          <Link
            href="/guides/how-ff-beacon-works"
            className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
          >
            See how FF Beacon's projections and matchups are calculated
          </Link>
          .
        </p>
        {/* Outside FaabForm on purpose: the form unmounts the masthead once a
            player is picked, and these words must stay on the page.
            The market section follows the explainer rather than sitting inside
            it, because ToolExplainer renders its steps, notes, FAQ and tiles as
            one block with no slot between them. */}
        <WrittenSections market={marketFacts} />
        <MarketStats facts={marketFacts} />
      </PageBody>
      <DiscordCtaSection
        eyebrow="Waivers are stressful"
        heading="Bidding blind? Ask before you spend your FAAB."
        body="A recommended range only goes so far. Drop your matchup into our Discord and real fantasy players will help you land on a number you feel good about, free. Want the story behind FF Beacon? Read about the project."
        isMember={isMember}
        memberHeading="Bid placed? There's more in the toolkit."
        memberBody="You're already part of the crew, so we'll skip the invite. Jump into the rest of the free FF Beacon tools to stay a step ahead on every roster move."
      />
    </main>
  );
}
