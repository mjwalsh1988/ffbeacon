import type { Metadata } from "next";
import Link from "next/link";
import { Scale, ShieldCheck, ListTree, ArrowRight } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { supportedFormats } from "@/lib/signal-check/format";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { SignalCheckBuilder, type FormatOption } from "./signal-check-builder";
import { SleeperImportPanel } from "./sleeper-import-panel";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { HeroAmbience } from "@/components/hero-ambience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Signal Check Trade Analyzer",
  description:
    "Build a fantasy football trade and get the Beacon Verdict: who wins, by how much, and why, powered by FF Beacon Values.",
};

export default async function SignalCheckPage() {
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

  const showImport = settings.enabled && settings.sleeperImportsEnabled;

  // Confirmed Discord members skip the invite: the hero button scrolls to the
  // builder and the bottom CTA points them at the rest of the toolkit.
  const isMember = await isDiscordMember();

  return (
    <main id="main">
      <Hero
        featureLabel={settings.publicLabel}
        resultLabel={settings.resultLabel}
        isMember={isMember}
      />

      <section
        id="signal-check-builder-section"
        aria-labelledby="builder-heading"
        className="scroll-mt-24 border-b border-line"
      >
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
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
            <div className="space-y-8">
              {showImport && (
                <>
                  <SleeperImportPanel signedIn={signedIn} initialUsername={savedUsername} />
                  <OrDivider />
                </>
              )}
              <SignalCheckBuilder
                formats={formats}
                minLength={settings.autocompleteMinLength}
              />
            </div>
          )}
        </div>
      </section>
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

function Hero({
  featureLabel,
  resultLabel,
  isMember,
}: {
  featureLabel: string;
  resultLabel: string;
  isMember: boolean;
}) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      <HeroAmbience variant="center" />
      <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <h1
          aria-label={`${featureLabel}: the FF Beacon trade analyzer`}
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          {featureLabel}:{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
          >
            the {resultLabel}, explained.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
          Add players and draft picks to each side. {featureLabel} weighs them with FF Beacon
          Values for your league format and returns the {resultLabel}: who wins, the margin, and a
          plain-language reason, with no guesswork.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <MemberHeroCta
            isMember={isMember}
            size="lg"
            memberMode="scroll"
            memberScrollTargetId="signal-check-builder-section"
            memberLabel="Build a trade"
            memberIcon="arrow-down"
          />
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            View player rankings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        <ul role="list" aria-label="How Signal Check works" className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <HeroBullet icon={Scale} title="FF Beacon Values" body="One trusted value scale, weighted for your format." />
          <HeroBullet icon={ListTree} title="Transparent reasons" body="Every adjustment is traced, not hand-waved." />
          <HeroBullet icon={ShieldCheck} title="Shareable verdicts" body="Freeze a result and share a clean public link." />
        </ul>

      </div>
    </header>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-4" role="separator" aria-label="or build your own trade below">
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted"
      >
        or
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}

function HeroBullet({ icon: Icon, title, body }: { icon: typeof Scale; title: string; body: string }) {
  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}
