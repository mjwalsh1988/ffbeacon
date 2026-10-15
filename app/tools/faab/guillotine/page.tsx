import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { FormatFallbackBanner } from "@/components/format-fallback-banner";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { FaabForm } from "../faab-form";
import { parseManualSeed } from "../manual-setup";
import { loadFaabCalculatorData } from "../calculator-data";
import { seasonOptions } from "../season-options";
import { loadChoppedMarket } from "@/lib/faab/chopped-market";
import { GuillotineWrittenSections } from "./written-sections";
import { ChoppedMarketTable } from "./chopped-market-table";

/**
 * /tools/faab/guillotine
 *
 * The chopped and guillotine front door to the FAAB calculator. Same form,
 * same data, same model as /tools/faab; the league type is pinned to chopped
 * and the page carries its own title, heading, copy and FAQ so the two URLs
 * read as two pages. The plan of record is
 * docs/seo-audit/gsc-growth-plan-2026-10-15.md, section 3.
 *
 * Deliberately absent: the general page's WrittenSections, MarketStats and
 * DynastySection. Repeating those blocks here is what would make a search
 * engine treat the two URLs as one page.
 */

const META_TITLE = "Guillotine League FAAB Calculator: Chopped League Bids";
const META_DESCRIPTION =
  "Free guillotine league FAAB calculator: what to bid this week in a chopped, guillotine, death or knockout league, your odds of being chopped before and after the claim, and when to keep the money.";

export const metadata: Metadata = {
  alternates: { canonical: "/tools/faab/guillotine" },
  title: META_TITLE,
  description: META_DESCRIPTION,
  ...pageShareMetadata({
    key: "faab-guillotine",
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: "/tools/faab/guillotine",
  }),
};

export const dynamic = "force-dynamic";

export default async function GuillotineFaabPage({
  searchParams,
}: {
  searchParams: Promise<{
    format?: string;
    source?: string;
    /** Shareable-link override. Wins over the reader's saved handle. */
    username?: string | string[];
    /** Ignored: this page is always chopped. */
    kind?: string | string[];
    /**
     * The chopped guide's danger form sends these: the field the league
     * started with, the field still alive and how close to the cut the
     * reader is. Parsed strictly by `parseManualSeed`; anything unexpected is
     * ignored.
     */
    start?: string | string[];
    alive?: string | string[];
    danger?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // The spread first and `kind` last, so the URL can never set a different
  // league type on this page.
  const seed = parseManualSeed({ ...params, kind: "chopped" });
  const [data, choppedMarket] = await Promise.all([
    loadFaabCalculatorData(params),
    loadChoppedMarket(),
  ]);
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
    mastheadChips,
  } = data;

  const webApplicationLd = webApplicationJsonLd({
    name: META_TITLE,
    description: META_DESCRIPTION,
    url: "/tools/faab/guillotine",
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
            title="Guillotine and chopped league FAAB calculator"
            description="Every claim priced against your odds of being chopped this week. Tell it how many teams started, how many are left and where you stand, or connect your Sleeper chopped league."
            chips={mastheadChips}
            actions={
              <>
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
                  href="/guides/chopped-league-strategy"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Chopped league strategy
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
          seed={seed}
          pagePath="/tools/faab/guillotine"
        />
        <p className="mt-8 text-sm leading-relaxed text-ink-muted">
          Not in a chopped league? The{" "}
          <Link
            href="/tools/faab"
            className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
          >
            FAAB calculator
          </Link>{" "}
          prices redraft and dynasty claims.
        </p>
        <GuillotineWrittenSections />
        <ChoppedMarketTable market={choppedMarket} />
      </PageBody>
      <DiscordCtaSection
        eyebrow="One bad week and you are out"
        heading="Not sure the bid is enough? Ask before the chop."
        body="A recommended range only goes so far when the lowest score of the week sends a team home. Drop your standing and the player into our Discord and real fantasy players will help you settle on a number before waivers run, free."
        isMember={isMember}
        memberHeading="Claim in? Set the lineup that keeps you alive."
        memberBody="You're already part of the crew, so we'll skip the invite. The rest of the free FF Beacon tools are a click away when you need help with this week's lineup."
      />
    </main>
  );
}
