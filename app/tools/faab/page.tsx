import type { Metadata } from "next";
import { Suspense } from "react";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FormatFallbackBanner } from "@/components/format-fallback-banner";
import { FaabForm } from "./faab-form";
import { loadFaabCalculatorData } from "./calculator-data";
import { ThisWeekWireForReader } from "./this-week";
import { parseManualSeed } from "./manual-setup";
import { seasonOptions } from "./season-options";
import { WrittenSections } from "./written-sections";
import { MarketStats } from "./market-stats";
import { DynastySection } from "./dynasty-section";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";

const META_TITLE = "FAAB Calculator for Fantasy Football: What to Bid";
// The title is left alone deliberately: it is what ranks today and a rewrite
// resets a snippet Google has already learned. The description gains "dynasty"
// only, which the page had covered in one FAQ line and now covers with a
// section, a chart and two tables.
const META_DESCRIPTION =
  "Free FAAB calculator: how much to bid on any waiver claim, your chance to win it, and when to walk away. Dynasty, chopped and guillotine leagues too.";

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
  const data = await loadFaabCalculatorData(params);
  const {
    settings,
    players,
    format,
    formatSlug,
    requestedSourceSlug,
    reconciled,
    fallbackBanner,
    rankingsSourceName,
    valueSourceName,
    valueSourceIsBeacon,
    handleGate,
    urlViewer,
    isMember,
    marketFacts,
    mastheadChips,
  } = data;
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
        <FormatFallbackBanner fallback={reconciled.fallback} />
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
          readerSourceSlug={requestedSourceSlug}
          handleGate={handleGate}
          urlViewer={urlViewer}
          seed={manualSeed}
          onGuillotinePage={false}
        />
        <p className="mt-8 text-sm leading-relaxed text-ink-muted">
          Playing in a chopped or guillotine league? The{" "}
          <Link
            href="/tools/faab/guillotine"
            className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
          >
            guillotine FAAB calculator
          </Link>{" "}
          prices every claim against your odds of being chopped this week.
        </p>
        {/* Server rendered on first paint, so the page changes every waiver week
            without touching the title above. Suspense so a slow board read can
            never hold up the calculator. */}
        <Suspense fallback={null}>
          <ThisWeekWireForReader params={{ format: params.format, source: params.source }} />
        </Suspense>
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
        {/* After the market tables on purpose. Those establish what a claim
            costs across every league we hold; this one splits the largest
            division inside that number and needs the general figure to have
            been made first. */}
        <DynastySection facts={marketFacts} />
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
