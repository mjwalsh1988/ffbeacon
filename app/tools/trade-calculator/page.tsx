import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import { Scale, ShieldCheck, ListTree, ArrowRight } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { supportedFormats } from "@/lib/signal-check/format";
import { resolveFormatSlug } from "@/lib/preferences";
import { isSignedIn, loadSavedSleeperHandle } from "@/lib/sleeper-handle/resolve";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import type { FormatOption } from "./signal-check-builder";
import { SignalCheckWorkspace } from "./signal-check-workspace";
import { WrittenSections, buildTradeCalculatorFaq } from "./written-sections";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";

export const dynamic = "force-dynamic";

/**
 * WHAT IT IS COMES FIRST, WHAT IT IS CALLED COMES SECOND.
 *
 * Nobody searches for "Signal Check". They search for a trade calculator, and a
 * result is read left to right, in a box that clips around sixty characters. So
 * the head term opens both the title and the description, and the product name
 * follows it in the same breath. The brand is not lost: it is in the title, in
 * the description, in the h1 and in the site suffix the layout appends.
 *
 * The title and the h1 both build the same phrase through buildTradeCalculatorTitle
 * below, fed `settings.publicLabel`, which is admin-editable. `metadata` used to be
 * a static object, evaluated at module scope, unable to await a settings read, so it
 * hard-coded "Signal Check" while the h1 read the live label: the two could drift the
 * moment the label was renamed in admin. generateMetadata reads the same settings
 * loader the page body reads, memoised for a minute (lib/memo-ttl.ts), so this adds
 * no second uncached query.
 */
const META_DESCRIPTION =
  "Free fantasy football trade calculator. Put both sides into Signal Check and get a straight answer: who wins and by how much. Redraft or dynasty.";

function buildTradeCalculatorTitle(featureLabel: string): string {
  return `Fantasy Football Trade Calculator: ${featureLabel}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  const title = buildTradeCalculatorTitle(settings.publicLabel);
  return {
    alternates: { canonical: "/tools/trade-calculator" },
    title,
    description: META_DESCRIPTION,
    ...pageShareMetadata({
      key: "signal-check",
      title,
      description: META_DESCRIPTION,
      path: "/tools/trade-calculator",
    }),
  };
}

export default async function SignalCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; source?: string }>;
}) {
  const params = await searchParams;
  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  const formatRows = settings.enabled ? await supportedFormats(admin, settings) : [];
  const formats: FormatOption[] = formatRows.map((f) => ({
    slug: f.slug,
    display: f.display,
    leagueType: f.leagueType,
    allowsPicks: f.allowsPicks,
  }));

  // The inline Sleeper import panel adapts to auth state. We resolve the signed
  // in reader and their saved Sleeper handle here so the panel can open straight
  // into the league picker (or the save-handle step) without a round trip.
  //
  // The handle comes from the one resolver (D1). This page has no `?username=`
  // path: the import reads the SAVED handle server-side on every call, so a
  // link that named someone else's handle would not change what it imports.
  const cookieClient = await createClient();
  const signedIn = await isSignedIn(cookieClient);
  const savedHandle = signedIn ? await loadSavedSleeperHandle(cookieClient) : null;
  const savedUsername = savedHandle?.username ?? null;

  // The builder opens on the format the reader already has selected in the
  // site header, so the trade is priced on their own scale without them being
  // asked a question they have answered elsewhere. The chip in the toolbar
  // shows which one is in force and changes it in two clicks.
  //
  // A header format Signal Check cannot price (inactive, or admin-disabled)
  // falls back to the first supported format rather than opening on nothing:
  // the tool is unusable without one, and the chip makes the choice visible.
  // `initialFormatFromHeader` is what separates the two cases for the copy.
  const formatResolution = await resolveFormatSlug(cookieClient, params.format);
  const headerFormatSupported = formats.some((f) => f.slug === formatResolution.slug);
  const initialFormatSlug = headerFormatSupported
    ? formatResolution.slug
    : (formats[0]?.slug ?? "");

  const initialFormatFromHeader = headerFormatSupported && formatResolution.origin !== "default";

  const showImport = settings.enabled && settings.sleeperImportsEnabled;

  // Confirmed Discord members skip the invite: the hero button scrolls to the
  // builder and the bottom CTA points them at the rest of the toolkit.
  const isMember = await isDiscordMember();

  // The FAQPage block mirrors the written FAQ verbatim, built from the same
  // buildTradeCalculatorFaq(settings) the visible section renders, so the
  // structured data can never claim to answer a question the page does not
  // actually show. Matches the house pattern at
  // app/guides/fantasy-football-terms/page.tsx.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: buildTradeCalculatorFaq(settings).map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  const webApplicationLd = webApplicationJsonLd({
    name: buildTradeCalculatorTitle(settings.publicLabel),
    description: META_DESCRIPTION,
    url: "/tools/trade-calculator",
    category: "SportsApplication",
  });

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(webApplicationLd) }}
      />
      <PageBody>
        <Masthead
          featureLabel={settings.publicLabel}
          resultLabel={settings.resultLabel}
          isMember={isMember}
        />

        <section
          id="signal-check-builder-section"
          aria-labelledby="builder-heading"
          className="mt-8 scroll-mt-24"
        >
          {/* The builder is two rosters side by side and a verdict between
              them, so it reads better with room than centred in a narrow
              column. Still capped rather than edge to edge: past about 90rem
              the two sides drift far enough apart that comparing them means
              moving your head. */}
          <div className="mx-auto max-w-[90rem]">
            <h2 id="builder-heading" className="sr-only">
              Build a trade
            </h2>

            {!settings.enabled || formats.length === 0 ? (
              <p
                role="status"
                className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted"
              >
                {settings.publicLabel} is not available right now. Please check back soon.
              </p>
            ) : (
              <SignalCheckWorkspace
                formats={formats}
                minLength={settings.autocompleteMinLength}
                initialFormatSlug={initialFormatSlug}
                initialFormatFromHeader={initialFormatFromHeader}
                showImport={showImport}
                signedIn={signedIn}
                initialUsername={savedUsername}
              />
            )}
          </div>
        </section>

        <WrittenSections settings={settings} />

        <p className="mx-auto mt-10 max-w-5xl text-sm leading-relaxed text-ink-muted">
          <Link
            href="/guides/how-ff-beacon-works"
            className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
          >
            How FF Beacon's values and projections are built, site-wide
          </Link>
        </p>
      </PageBody>
      <DiscordCtaSection
        eyebrow="Not sure about the verdict?"
        heading="Get a second opinion before you hit send."
        body="A Beacon Verdict is a great starting point, but our Discord is full of real managers who will sanity-check any trade with you for free. Curious how the values behind it are built? Read about FF Beacon."
        isMember={isMember}
        memberHeading="Verdict in hand? Put the rest of the toolkit to work."
        memberBody="You're already in the crew, so skip the invite. Explore the other free FF Beacon tools to keep building a smarter roster."
      />
    </main>
  );
}

function Masthead({
  featureLabel,
  resultLabel,
  isMember,
}: {
  featureLabel: string;
  resultLabel: string;
  isMember: boolean;
}) {
  // The h1 leads with what the tool IS and names it second, matching the meta
  // title above. A reader searching for a trade calculator does not know this
  // one is called Signal Check, so the words they typed are the first thing on
  // the page they land on, and the name is right beside them.
  //
  // The description then does the explaining, which is what it is for. It says
  // the name again rather than repeating "fantasy football trade calculator":
  // the phrase is already in the title, the description and the heading, and a
  // fourth run of it would read like it was written for a crawler.
  return (
    <PageMasthead
      eyebrow="Tools"
      title={buildTradeCalculatorTitle(featureLabel)}
      description={`Add players and draft picks to each side. ${featureLabel} weighs them with FF Beacon Values for your league format and returns the ${resultLabel}: who wins, the margin, and a plain-language reason, with no guesswork.`}
      actions={
        <>
          {/* Short labels on purpose: the hero shows two of these three buttons
              at once, and the longer wording pushed the pair onto two rows at
              phone width. */}
          <MemberHeroCta
            isMember={isMember}
            size="lg"
            memberMode="scroll"
            memberScrollTargetId="signal-check-builder-section"
            memberLabel="Build Trade"
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
        aria-label="How Signal Check works"
        // Three across at every width. On a phone they used to stack into three
        // full cards, which is a screen of marketing between the hero and the
        // builder, so there they compress to icon and title on one line and the
        // supporting line goes screen-reader-only. Matches League Pulse.
        className="grid grid-cols-3 gap-2 sm:gap-4"
      >
        <HeroBullet
          icon={Scale}
          title="FF Beacon Values"
          body="One trusted value scale, weighted for your format."
        />
        <HeroBullet
          icon={ListTree}
          title="Transparent reasons"
          body="Every adjustment is traced, not hand-waved."
        />
        <HeroBullet
          icon={ShieldCheck}
          title="Shareable verdicts"
          body="Freeze a result and share a clean public link."
        />
      </ul>
    </PageMasthead>
  );
}

function HeroBullet({ icon: Icon, title, body }: { icon: typeof Scale; title: string; body: string }) {
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
