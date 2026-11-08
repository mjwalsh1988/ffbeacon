import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/app-shell/page-body";
import { LongShotHero } from "@/components/long-shot/hero";
import { Stage } from "@/components/long-shot/stage";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { currentEasternGameDate } from "@/lib/game-date";
import { puzzleDateLabel } from "@/lib/long-shot/dates";
import { loadLeaderboardView, type LeaderboardView } from "@/lib/long-shot/leaderboards";
import { loadPageState } from "@/lib/long-shot/page-state";
import { loadLongShotSettings } from "@/lib/long-shot/settings";
import { pageShareMetadata } from "@/lib/page-og";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { LongShotDemo } from "./demo";
import { HowItWorks } from "./how-it-works";
import { LeaderboardRail } from "./leaderboard-rail";
import { LongShotClient } from "./long-shot-client";
import { WrittenSections } from "./written-sections";

const META_TITLE = "Long Shot: The Daily Fantasy Football Rarity Game";
const META_DESCRIPTION =
  "Five fantasy prompts, the same for everyone, every day. Name a player who fits. The answer everyone gives scores 10; the one nobody rosters scores 100.";

export const metadata: Metadata = {
  alternates: { canonical: "/games/long-shot" },
  title: META_TITLE,
  description: META_DESCRIPTION,
  ...pageShareMetadata({
    key: "long-shot",
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: "/games/long-shot",
  }),
};

export const dynamic = "force-dynamic";

/**
 * Long Shot, the daily rarity game (docs/completed/long-shot/long-shot-plan.md).
 *
 * Server shell. Reads the settings, the user and, for a signed-in reader, the
 * page state (through the same loader GET /state uses) and page 1 of the
 * daily board. It never generates a puzzle; that happens in the 17:00 UTC
 * cron or, as a fallback, inside the attempt route.
 *
 * Signed out, nothing from the database is read but the settings row: the
 * demo runs on data shipped in code, and the boards say they exist without
 * sending a single row to the page source.
 */
export default async function LongShotPage() {
  const admin = createAdminClient();
  const settings = await loadLongShotSettings(admin);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const today = currentEasternGameDate();

  const ld = webApplicationJsonLd({
    name: META_TITLE,
    description: META_DESCRIPTION,
    url: "/games/long-shot",
    category: "GameApplication",
  });

  let body: React.ReactNode;
  let dateLine = user ? puzzleDateLabel(today) : "Sign in to play today's five.";
  let streak = 0;

  if (!settings.game_enabled) {
    body = (
      <Stage>
        <h2 className="text-2xl font-bold text-ink">Long Shot is paused</h2>
        <p className="mt-3 text-base text-ink-muted">Long Shot is paused. Check back soon.</p>
      </Stage>
    );
  } else if (!user) {
    body = (
      <div className="space-y-8">
        <LongShotDemo />
        <div className="mx-auto max-w-3xl rounded-[20px] border border-brand-cyan/40 bg-brand-cyan/5 p-5 text-center sm:p-6">
          <p className="text-base text-ink">Today&apos;s five are waiting. An account is free.</p>
          <Link
            href="/login?next=/games/long-shot"
            className="mt-4 inline-flex h-12 items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sign in to play
          </Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <LeaderboardRail signedIn={false} enabled={settings.leaderboards.enabled} initialView={null} />
          <HowItWorks settings={settings} />
        </div>
      </div>
    );
  } else {
    const state = await loadPageState(admin, user.id, today, settings);
    if (state.active) dateLine = puzzleDateLabel(state.active.gameDate);
    streak = state.stats?.currentStreak ?? 0;
    let initialBoardView: LeaderboardView | null = null;
    if (settings.leaderboards.enabled) {
      try {
        initialBoardView = await loadLeaderboardView(admin, settings, "daily", 1, today, today, user.id);
      } catch (err) {
        // A board outage degrades to the panel's own empty state, never the page.
        console.error("[long-shot] board load failed", err);
      }
    }
    body = (
      <LongShotClient
        initialState={state}
        timerSeconds={settings.timer.seconds}
        filmRoomEnabled={settings.film_room_enabled}
        leaderboardsEnabled={settings.leaderboards.enabled}
        initialBoardView={initialBoardView}
        extra={<HowItWorks settings={settings} />}
      />
    );
  }

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) }}
      />
      <PageBody width="tool">
        <div className="space-y-8">
          <LongShotHero dateLine={dateLine} streak={streak} />
          {body}
          {settings.game_enabled && <WrittenSections settings={settings} />}
        </div>
      </PageBody>
    </main>
  );
}
