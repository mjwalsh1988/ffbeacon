import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSleeperUser, getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";
import { LeagueResults } from "@/app/tools/league-sync/league-results";
import { SaveUsernameForm } from "./save-username-form";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your saved Sleeper leagues and rosters at a glance.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_username, default_format_config_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const sleeperUsername = prefs?.sleeper_username ?? "";
  const season = currentNflSeason();

  let leagues: Awaited<ReturnType<typeof getSleeperLeagues>> = [];
  let sleeperUser = null;
  if (sleeperUsername) {
    sleeperUser = await getSleeperUser(sleeperUsername);
    if (sleeperUser) {
      leagues = await getSleeperLeagues(sleeperUser.user_id, season);
    }
  }

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Your dashboard
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Welcome back{user.email ? `, ${user.email.split("@")[0]}` : ""}
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Saved Sleeper leagues, rankings shortcuts, and your default format live here.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6 lg:px-8">
        <section aria-labelledby="sleeper-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="sleeper-heading" className="text-2xl font-semibold tracking-tight">
              Sleeper leagues
            </h2>
            {sleeperUsername && (
              <p className="text-sm text-ink-muted">
                Connected as <span className="font-medium text-ink">{sleeperUsername}</span>
              </p>
            )}
          </div>
          <SaveUsernameForm defaultUsername={sleeperUsername} />
          {sleeperUsername && !sleeperUser && (
            <p role="alert" className="mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
              We could not load Sleeper user "{sleeperUsername}". Double-check the spelling above.
            </p>
          )}
          {sleeperUser && leagues.length === 0 && (
            <p className="mt-4 text-sm text-ink-muted">
              No active leagues for {season}. If you joined a league after this page loaded, refresh.
            </p>
          )}
          {leagues.length > 0 && <LeagueResults leagues={leagues} season={season} />}
        </section>

        <section aria-labelledby="quick-heading">
          <h2 id="quick-heading" className="text-2xl font-semibold tracking-tight">
            Quick links
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            <li>
              <Link
                href="/rankings"
                className="block rounded-card border border-line bg-surface p-5 hover:border-brand-purple"
              >
                <h3 className="text-base font-semibold text-ink">Rankings</h3>
                <p className="mt-2 text-sm text-ink-muted">Sortable rankings across every format.</p>
              </Link>
            </li>
            <li>
              <Link
                href="/tools/faab"
                className="block rounded-card border border-line bg-surface p-5 hover:border-brand-purple"
              >
                <h3 className="text-base font-semibold text-ink">FAAB calculator</h3>
                <p className="mt-2 text-sm text-ink-muted">Plan your next waiver wire bid.</p>
              </Link>
            </li>
            <li>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="block w-full rounded-card border border-line bg-surface p-5 text-left hover:border-line-accent"
                >
                  <span className="block text-base font-semibold text-ink">Sign out</span>
                  <span className="mt-2 block text-sm text-ink-muted">End this session.</span>
                </button>
              </form>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
