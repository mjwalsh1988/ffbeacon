import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import { Scale, ShieldCheck, ListTree, ArrowRight } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { supportedFormats } from "@/lib/signal-check/format";
import { resolveFormatSlug } from "@/lib/preferences";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import type { FormatOption } from "./signal-check-builder";
import { SignalCheckWorkspace } from "./signal-check-workspace";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/tools/signal-check" },
  title: "Trade Analyzer: Is This Trade Fair?",
  description:
    "Put both sides of a fantasy football trade in and get a straight answer: who wins, by how much, and the reason why. Players and draft picks, redraft or dynasty, free to use.",
  ...pageShareMetadata({
    key: "signal-check",
    title: "Trade Analyzer: Is This Trade Fair?",
    description:
      "Put both sides of a fantasy football trade in and get a straight answer: who wins, by how much, and the reason why. Players and draft picks, redraft or dynasty, free to use.",
    path: "/tools/signal-check",
  }),
};

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
  // in user and their saved Sleeper username here so the panel can open straight
  // into the league picker (or the save-username step) without a round trip.
  const cookieClient = await createClient();
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
  const signedIn = Boolean(user);

  let savedUsername: string | null = null;
  if (user) {
    const { data: prefs } = await cookieClient
      .from("user_preferences")
      .select("sleeper_league_settings")
      .eq("user_id", user.id)
      .maybeSingle();
    savedUsername = parseSleeperLeagueSettings(prefs?.sleeper_league_settings).username ?? null;
  }

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

  return (
    <main id="main">
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
  return (
    <PageMasthead
      eyebrow="Tools"
      title={`${featureLabel}: the ${resultLabel}, explained.`}
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
