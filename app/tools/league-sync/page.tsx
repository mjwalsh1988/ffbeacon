import type { Metadata } from "next";
import Link from "next/link";
import { LeagueSyncForm } from "./league-sync-form";
import { LeagueResults } from "./league-results";
import { getSleeperUser, getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";

export const metadata: Metadata = {
  title: "Sleeper League Sync",
  description: "View every Sleeper league roster you own in one accessible place.",
};

export const dynamic = "force-dynamic";

export default async function LeagueSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ username?: string; season?: string }>;
}) {
  const params = await searchParams;
  const usernameInput = params.username?.trim();
  const season = params.season?.trim() || currentNflSeason();

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
      <header className="border-b border-line">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Tools
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Sleeper League Sync</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Drop in your Sleeper username to see every league, roster, and starter in one accessible
            table. No account required for this view.{" "}
            <Link href="/dashboard" className="text-brand-purple underline-offset-4 hover:underline">
              Sign in to save your username
            </Link>{" "}
            and load it instantly each visit.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <LeagueSyncForm defaultUsername={usernameInput ?? ""} defaultSeason={season} />
        {error && (
          <p role="alert" className="mt-6 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
            {error}
          </p>
        )}
        {user && (
          <p className="mt-6 text-sm text-ink-muted">
            Showing {leagues.length} league{leagues.length === 1 ? "" : "s"} for{" "}
            <span className="font-medium text-ink">{user.display_name}</span> ({season} season).
          </p>
        )}
        {user && leagues.length > 0 && (
          <LeagueResults leagues={leagues} season={season} />
        )}
      </div>
    </main>
  );
}
