import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CRON_JOBS } from "./cron-runs";

/**
 * Every job that produces data the site reads must be reachable by something
 * other than a person remembering to type a command.
 *
 * This is the test that would have caught two separate bugs in this codebase.
 * `scripts/sync-sleeper-players.ts` existed from the first commit and was never
 * scheduled, so injury designations froze for three months and players on IR
 * projected as healthy. `calculate-defense-splits` and
 * `calculate-projection-accuracy` were the same story, undetected because their
 * output happened to be correct in the preseason and would only have gone wrong
 * the week the regular season started.
 *
 * Neither had a failing job to notice, because a job that is never scheduled
 * never fails. Working backwards from the producers is the only way to see it,
 * the same argument lib/cron-health.ts makes about runs that never fire.
 *
 * A new derived-table producer either gets chained into a cron route, or gets
 * an explicit entry in ON_DEMAND_BY_DESIGN below saying why not. There is no
 * third option that leaves it silently unscheduled.
 */

const ROOT = join(__dirname, "..");
const CRON_DIR = join(ROOT, "app", "api", "cron");

/**
 * Producers that are deliberately NOT on a schedule, with the reason.
 *
 * Both league caches are per-league and recompute on demand when a league is
 * viewed, gated by their own TTLs. CLAUDE.md states as an absolute rule that
 * neither may be wired into a nightly cron: it does not scale to tens of
 * thousands of leagues, and a league nobody opens never needs a cache row.
 */
const ON_DEMAND_BY_DESIGN: Record<string, string> = {
  "league-power-rankings":
    "per-league, recomputed on view through pulseLeague (24h TTL). CLAUDE.md forbids a nightly cron over every league.",
  "league-power-pulse":
    "per-league, recomputed on view through pulseLeague (12h TTL). CLAUDE.md forbids a nightly cron over every league.",
};

/** Every lib module whose job is to (re)build a table the site reads. */
function derivedProducers(): string[] {
  return readdirSync(join(ROOT, "lib"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => f.startsWith("calculate-") || f.startsWith("sync-") || f === "seed-rankings.ts")
    .map((f) => f.replace(/\.ts$/, ""));
}

/** Concatenated source of every cron route, which is where chaining shows up. */
function cronRouteSource(): string {
  if (!existsSync(CRON_DIR)) return "";
  return readdirSync(CRON_DIR)
    .map((dir) => join(CRON_DIR, dir, "route.ts"))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
}

describe("derived data producers are reachable without a human", () => {
  const producers = derivedProducers();
  const cronSource = cronRouteSource();

  it("finds the producers and the cron routes at all", () => {
    // Guards every assertion below from passing vacuously on a bad path.
    expect(producers.length).toBeGreaterThan(5);
    expect(cronSource.length).toBeGreaterThan(500);
  });

  it.each(derivedProducers())("%s is scheduled, or documented as on-demand", (producer) => {
    if (producer in ON_DEMAND_BY_DESIGN) {
      expect(ON_DEMAND_BY_DESIGN[producer].length).toBeGreaterThan(20);
      return;
    }
    expect(
      cronSource.includes(producer),
      `lib/${producer}.ts builds data the site reads but no cron route imports it. ` +
        `Chain it into a cron route, or add it to ON_DEMAND_BY_DESIGN with the reason. ` +
        `An unscheduled producer never fails, so nothing else can tell you it stopped.`,
    ).toBe(true);
  });

  it("keeps the stats-derived calcs on the stats job specifically", () => {
    // They read player_stats and nothing else new, so the stats sync is the one
    // moment their inputs change. Landing them anywhere else would rebuild them
    // off yesterday's stats.
    const statsRoute = readFileSync(join(CRON_DIR, "sync-sleeper-stats", "route.ts"), "utf8");
    expect(statsRoute).toContain("calculate-positional-finishes");
    expect(statsRoute).toContain("calculate-defense-splits");
    expect(statsRoute).toContain("calculate-projection-accuracy");
  });

  it("registers every cron route's job name in CRON_JOBS", () => {
    // The registry is what the health watchdog works backwards from. A route
    // that fires on a schedule but is missing here is invisible to it, which is
    // the same blind spot an unscheduled producer has.
    //
    // The name is read out of the route's own recordCronRun() call rather than
    // assumed from the folder, because they legitimately differ: the folder
    // app/api/cron/beacon-brief records itself as "beacon-brief-curate".
    const registered = new Set<string>(CRON_JOBS.map((j) => j.name));
    const folders = readdirSync(CRON_DIR).filter((d) =>
      existsSync(join(CRON_DIR, d, "route.ts")),
    );
    expect(folders.length).toBeGreaterThan(5);

    for (const folder of folders) {
      const src = readFileSync(join(CRON_DIR, folder, "route.ts"), "utf8");
      const match = /recordCronRun\(\s*\w+\s*,\s*"([^"]+)"/.exec(src);
      expect(
        match,
        `app/api/cron/${folder} does not call recordCronRun with a literal job name, so its runs are unlogged`,
      ).not.toBeNull();
      expect(
        registered.has(match![1]),
        `app/api/cron/${folder} records itself as "${match![1]}", which is not in CRON_JOBS, so the health check cannot see it`,
      ).toBe(true);
    }
  });
});
