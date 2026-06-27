import type { Metadata } from "next";
import Link from "next/link";
import { Workflow, Sparkles, Lock, ArrowRight } from "lucide-react";
import { LeaguePulseForm } from "./league-pulse-form";
import { LeagueResults } from "./league-results";
import { ScrollToResults } from "./scroll-to-results";
import { getSleeperUser, getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";
import { createClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";

export const metadata: Metadata = {
  title: "Sleeper League Pulse",
  description: "View every Sleeper league roster you own in one accessible place.",
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

  let user = null;
  let leagues: Awaited<ReturnType<typeof getSleeperLeagues>> = [];
  let error: string | null = null;

  if (usernameInput) {
    user = await getSleeperUser(usernameInput);
    if (!user) {
      error = `No Sleeper user found for "${usernameInput}".`;
    } else {
      leagues = await getSleeperLeagues(user.user_id, season);
    }
  }

  return (
    <main id="main">
      <Hero />
      <section
        aria-labelledby="sync-heading"
        className="border-b border-line bg-surface/30"
      >
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <SectionEyebrow>Look up a username</SectionEyebrow>
          <h2
            id="sync-heading"
            className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Paste your Sleeper handle, pick a season.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
            We hit Sleeper directly and return every active league for that user
            and season. Tap any league to see its roster shape and open its
            deep view.
          </p>

          <div className="mt-6">
            <LeaguePulseForm defaultUsername={defaultUsername} defaultSeason={season} />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-6 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
            >
              {error}
            </p>
          )}
        </div>
      </section>

      {user && (
        <section
          id="league-results"
          aria-labelledby="results-heading"
          className="border-b border-line scroll-mt-4"
        >
          <ScrollToResults
            key={`${user.user_id}-${season}`}
            targetId="league-results"
            headingId="results-heading"
          />
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
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
                  {season} season · Sourced live from Sleeper.
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
                    you&rsquo;re looking at off-season state.
                  </p>
                </div>
              </div>
            ) : (
              <LeagueResults
                leagues={leagues}
                season={season}
                sleeperUsername={user.display_name ?? usernameInput ?? null}
              />
            )}
          </div>
        </section>
      )}

      {!isLoggedIn && <CtaSection />}
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* Beacon-gradient accent bar — matches home/about/author/my-beacon. */}
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
          Tools · Sleeper League Pulse
        </p>
        {/* aria-label gives the h1 a clean accessible name covering the
            entire headline even though the gradient is achieved via a
            nested span. */}
        <h1
          aria-label="Every Sleeper league you own, in one accessible table."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          Every Sleeper league you own,{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            in one accessible table.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
          Drop in your Sleeper username and we&rsquo;ll pull every active
          league — roster shape, season, status — right from the source. No
          account required for this view.{" "}
          <Link
            href="/my-beacon/sleeper-leagues"
            className="text-brand-purple underline-offset-4 hover:underline"
          >
            Sign in to save your username
          </Link>{" "}
          and load it instantly each visit.
        </p>

        <ul
          role="list"
          aria-label="What this tool does"
          className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
        >
          <HeroBullet
            icon={Sparkles}
            title="Live data"
            body="Hits Sleeper on every search — no stale cache."
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
      </div>
    </header>
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

/* ---------- CTA ---------- */

function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
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
