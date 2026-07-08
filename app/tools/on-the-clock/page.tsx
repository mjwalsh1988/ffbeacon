import type { Metadata } from "next";
import Link from "next/link";
import {
  Target,
  Scale,
  ArrowLeftRight,
  ArrowRight,
  Users,
  Receipt,
  TrendingUp,
  Trophy,
  Accessibility,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { currentNflSeason } from "@/lib/sleeper";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { OnTheClockClient } from "./on-the-clock-client";
import { StartDraftingButton } from "./start-drafting-button";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { DiscordGlyph } from "@/components/discord-glyph";

export const metadata: Metadata = {
  title: "On The Clock",
  description:
    "A Sleeper-connected live draft helper. Strip drafted players from the pool and surface the best remaining FF Beacon value for your league format, by eye or by ear.",
};

export const dynamic = "force-dynamic";

/**
 * On The Clock - public live-draft helper (PHASE 5: live data wiring).
 *
 * Server shell: resolves the dynamic NFL season, the signed-in user's saved
 * Sleeper handle (prefill), and the admin On The Clock settings (feature flag +
 * Realtime toggle + sync cooldown). When the feature is OFF it renders a clean
 * "not enabled yet" state instead of the cockpit. When ON, the client wires the
 * leagues / draft / sync routes and Supabase Realtime.
 *
 * The draft DATA is live (Phase 5). PHASE 6A/6A.2: the available big board is the
 * real FF Beacon ranked board. The value SOURCE is FORCED to FF Beacon and the
 * FORMAT is auto-detected per league from Sleeper (no global source/format
 * selectors); the board is fetched per-league inside the client (the format is
 * known only after a league is selected). Team Need + Trade Analyzer remain
 * sample/mock until Phase 6B/6C.
 */
export default async function OnTheClockPage() {
  const season = currentNflSeason();

  // Admin settings drive the feature gate, Realtime toggle, and sync cooldown.
  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);

  // Saved Sleeper handle (signed-in users) prefills the username gate.
  let savedUsername = "";
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (authUser) {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("sleeper_league_settings")
      .eq("user_id", authUser.id)
      .maybeSingle();
    savedUsername = parseSleeperLeagueSettings(prefs?.sleeper_league_settings).username ?? "";
  }

  return (
    <main id="main">
      <Hero />
      <section
        id="otc-connect"
        aria-labelledby="otc-app-heading"
        className="scroll-mt-24 border-b border-line"
      >
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <h2 id="otc-app-heading" className="sr-only">
            Connect a draft
          </h2>
          {settings.feature.enabled ? (
            <OnTheClockClient
              defaultSeason={season}
              defaultUsername={savedUsername}
              realtimeEnabled={settings.sync.realtimeEnabled}
              cooldownSeconds={settings.sync.cooldownSeconds}
              settings={settings}
            />
          ) : (
            <FeatureOffNotice />
          )}
        </div>
      </section>
      <DiscordCtaSection
        eyebrow="Need a hand mid-draft?"
        heading="Stuck on a pick? Real people are watching the clock too."
        body="Our Discord is full of drafters who will help you weigh a pick or a trade in real time, free, no matter how many rounds are left. Want to know what powers the recommendations? Read about FF Beacon."
      />
    </main>
  );
}

function FeatureOffNotice() {
  return (
    <div className="mx-auto max-w-2xl rounded-modal border border-line bg-surface/50 p-6 text-center sm:p-8">
      <span
        aria-hidden="true"
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Clock className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
        On The Clock is not enabled yet.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        We are putting the finishing touches on the live draft room. Check back soon.
        In the meantime, you can explore your leagues with Sleeper League Pulse.
      </p>
      <Link
        href="/tools/league-pulse"
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Open Sleeper League Pulse
      </Link>
    </div>
  );
}

const OTC_FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Target, title: "Best pick, live", body: "Best Available and Team Need" },
  { icon: Scale, title: "Trade calculator", body: "Weigh any offer fast" },
  { icon: ArrowLeftRight, title: "Trade analyzer", body: "Startup and rookie drafts" },
  { icon: Users, title: "Every roster", body: "All teams, one view" },
  { icon: Receipt, title: "Trades and moves", body: "Full transaction history" },
  { icon: TrendingUp, title: "Power rankings", body: "Live and league-tuned" },
  { icon: Trophy, title: "Grades and awards", body: "Startup draft recap" },
  { icon: Accessibility, title: "Screen-reader native", body: "Read it or hear it" },
];

function Hero() {
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
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-20 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Tools · On The Clock
        </p>
        <h1
          aria-label="Your signal on the clock, live draft help by eye or by ear."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          Your signal on the clock,{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
          >
            live draft help by eye or by ear.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
          Drafting right now? Connect your live Sleeper draft and FF Beacon calls out
          exactly where your team needs help, runs trade offers through a built-in
          calculator and an analyzer for startup and rookie drafts, and opens every team
          roster, the full trade history, live power rankings, and startup draft grades
          and awards. Every view works the same whether you read it or hear it.
        </p>

        <StartDraftingButton />

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/join"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join our Discord (opens in new tab)"
            className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <DiscordGlyph className="h-5 w-5" />
            Join our Discord
          </a>
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            View player rankings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Continuous horizontal marquee: one always-moving row that fits every
            card without stacking. The track holds the real list plus an
            aria-hidden duplicate so the loop is seamless; screen readers only see
            the real list once. Edges fade via a mask. Pauses on hover/focus and
            falls back to a scrollable row under reduced-motion (see globals.css). */}
        <div
          className="otc-marquee mt-8"
          style={{
            maskImage:
              "linear-gradient(90deg, transparent 0, #000 4%, #000 96%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(90deg, transparent 0, #000 4%, #000 96%, transparent 100%)",
          }}
        >
          <div className="otc-marquee-track flex w-max">
            <ul role="list" aria-label="What this tool does" className="flex shrink-0">
              {OTC_FEATURES.map((f) => (
                <HeroBullet key={f.title} icon={f.icon} title={f.title} body={f.body} />
              ))}
            </ul>
            <ul aria-hidden="true" className="flex shrink-0">
              {OTC_FEATURES.map((f) => (
                <HeroBullet key={f.title} icon={f.icon} title={f.title} body={f.body} />
              ))}
            </ul>
          </div>
        </div>

      </div>
    </header>
  );
}

function HeroBullet({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="mr-3 flex w-52 shrink-0 items-center gap-3 rounded-card border border-line bg-surface/60 p-3 sm:w-56">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{body}</span>
      </span>
    </li>
  );
}
