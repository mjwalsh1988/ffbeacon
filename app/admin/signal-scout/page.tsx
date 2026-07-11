import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { currentEasternGameDate } from "@/lib/signal-scout/streaks";
import { TIER_DISPLAY_NAMES, type ClueTierChipKey } from "@/app/games/signal-scout/clue-grid";
import { SignalScoutSubnav } from "@/components/admin/signal-scout-subnav";
import { PlayerInsightTables } from "./player-insight-tables";
import { RecentRoundsTable } from "./recent-rounds-table";
import { RecentGuessesTable } from "./recent-guesses-table";
import {
  aggregateTargets,
  aggregateMostGuessed,
  computeAverages,
  pickEasiest,
  pickHardest,
  pickMostSkipped,
  type WindowRoundRow,
} from "./insights";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Signal Scout" };

const COMPLETED_WINDOW_LIMIT = 1000;
const GUESSES_WINDOW_LIMIT = 5000;
const CLUE_TIERS: ClueTierChipKey[] = ["starter", "weak", "clear", "ping", "scan"];

function fmtCount(n: number | null): string {
  if (n == null) return "n/a";
  return new Intl.NumberFormat("en-US").format(n);
}

function fmt1(n: number | null): string {
  return n == null ? "n/a" : n.toFixed(1);
}

export default async function SignalScoutAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ roundsPage?: string; guessesPage?: string }>;
}) {
  // Independent re-check (defense in depth alongside the layout gate).
  await requireAdmin("/admin/signal-scout");

  const { roundsPage, guessesPage } = await searchParams;
  const roundsPageNum = Math.max(1, Number.parseInt(roundsPage ?? "1", 10) || 1);
  const guessesPageNum = Math.max(1, Number.parseInt(guessesPage ?? "1", 10) || 1);

  const admin = createAdminClient();
  const todayGameDate = currentEasternGameDate();

  const [totalRounds, roundsToday, wonRounds, solvedLateRounds, failedRounds, skippedRounds, activeRounds, burnedOutRounds] =
    await Promise.all([
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("game_date", todayGameDate),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("status", "won"),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("status", "solved_late"),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("status", "failed"),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("status", "skipped"),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).not("burned_out_at", "is", null),
    ]);

  const [windowRes, guessesRes, clueCountsRes] = await Promise.all([
    admin
      .from("signal_scout_rounds")
      .select("status, score_awarded, hints_used, target_player_id")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(COMPLETED_WINDOW_LIMIT),
    admin
      .from("signal_scout_guesses")
      .select("guessed_player_id")
      .order("created_at", { ascending: false })
      .limit(GUESSES_WINDOW_LIMIT),
    Promise.all(
      CLUE_TIERS.map((tier) =>
        admin
          .from("signal_scout_round_clues")
          .select("round_id", { count: "exact", head: true })
          .eq("tier", tier)
          .eq("is_revealed", true),
      ),
    ),
  ]);

  const statCountResults = [
    ["total rounds", totalRounds],
    ["rounds today", roundsToday],
    ["won", wonRounds],
    ["solved late", solvedLateRounds],
    ["failed", failedRounds],
    ["skipped", skippedRounds],
    ["active", activeRounds],
    ["burned out", burnedOutRounds],
  ] as const;
  for (const [label, res] of statCountResults) {
    if (res.error) {
      console.error(`[signal-scout-admin] stat count query failed (${label})`, res.error);
    }
  }
  clueCountsRes.forEach((res, index) => {
    if (res.error) {
      console.error(
        `[signal-scout-admin] clue usage count failed (${CLUE_TIERS[index]})`,
        res.error,
      );
    }
  });
  if (windowRes.error) {
    console.error("[signal-scout-admin] completed-rounds window query failed", windowRes.error);
  }
  if (guessesRes.error) {
    console.error("[signal-scout-admin] guesses window query failed", guessesRes.error);
  }

  const windowRows: WindowRoundRow[] = windowRes.data ?? [];
  const guessRows = guessesRes.data ?? [];

  const byTarget = aggregateTargets(windowRows);
  const { avgWinningScore, avgHints } = computeAverages(windowRows);
  const hardest = pickHardest(byTarget);
  const easiest = pickEasiest(byTarget);
  const mostSkipped = pickMostSkipped(byTarget);
  const mostGuessed = aggregateMostGuessed(guessRows);

  const insightPlayerIds = [
    ...new Set([...hardest, ...easiest, ...mostSkipped, ...mostGuessed].map((r) => r.playerId)),
  ];
  const { data: insightPlayersData } = insightPlayerIds.length
    ? await admin
        .from("players")
        .select("id, full_name, first_name, last_name, position")
        .in("id", insightPlayerIds)
    : { data: [] };
  const playerNames = new Map(
    (insightPlayersData ?? []).map((p) => [
      p.id,
      {
        name: p.full_name || `${p.first_name} ${p.last_name}`.trim() || "Unknown player",
        position: p.position,
      },
    ]),
  );

  const clueUsage = new Map<ClueTierChipKey, number | null>(
    CLUE_TIERS.map((tier, index) => [tier, clueCountsRes[index]?.count ?? null]),
  );

  const stats: Array<{ label: string; value: string; caption: string }> = [
    {
      label: "Total rounds",
      value: fmtCount(totalRounds.count),
      caption: "All Signal Scout rounds ever started.",
    },
    {
      label: "Rounds today",
      value: fmtCount(roundsToday.count),
      caption: "Started on today's ET game day.",
    },
    { label: "Wins", value: fmtCount(wonRounds.count), caption: "Rounds ending in a win." },
    {
      label: "Solved too late",
      value: fmtCount(solvedLateRounds.count),
      caption: "Correct guess after the signal burned out.",
    },
    { label: "Failed", value: fmtCount(failedRounds.count), caption: "Ran out of bad reads." },
    { label: "Skipped", value: fmtCount(skippedRounds.count), caption: "Closed with no guess." },
    { label: "Active now", value: fmtCount(activeRounds.count), caption: "Currently in progress." },
    {
      label: "Burned out",
      value: fmtCount(burnedOutRounds.count),
      caption: "Rounds where the signal burned out.",
    },
    {
      label: "Avg winning score",
      value: fmt1(avgWinningScore),
      caption: "Score awarded, won rounds only.",
    },
    {
      label: "Avg hints per round",
      value: fmt1(avgHints),
      caption: "Hints used, all completed rounds.",
    },
  ];

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Signal Scout</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Activity, difficulty, and clue usage for the Signal Scout guessing game. Integrity,
          player overrides, user management, and game settings live on their own tabs below.
        </p>
      </div>

      <SignalScoutSubnav />

      <div className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:px-6 lg:px-8">
        <section aria-labelledby="signal-scout-stats-heading">
          <h2
            id="signal-scout-stats-heading"
            className="text-xl font-semibold tracking-tight text-ink"
          >
            At a glance
          </h2>
          <ul role="list" className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            {stats.map((stat) => (
              <li key={stat.label} className="rounded-card border border-line bg-surface/60 p-4">
                <p
                  className="bg-clip-text font-mono text-2xl font-bold tabular-nums text-transparent sm:text-3xl"
                  style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
                >
                  {stat.value}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  {stat.label}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">{stat.caption}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-subtle">
            Averages computed over the most recent {fmtCount(windowRows.length)} completed rounds.
          </p>
        </section>

        <PlayerInsightTables
          hardest={hardest}
          easiest={easiest}
          mostSkipped={mostSkipped}
          mostGuessed={mostGuessed}
          playerNames={playerNames}
        />

        <section aria-labelledby="signal-scout-clue-usage-heading">
          <h2
            id="signal-scout-clue-usage-heading"
            className="text-xl font-semibold tracking-tight text-ink"
          >
            Clue usage by tier
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            How many revealed clues, across every round, fall into each tier.
          </p>
          <div
            tabIndex={0}
            role="region"
            aria-label="Clue usage by tier table, scrollable"
            className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <caption className="sr-only">
                Count of revealed clues per tier, from starter to full scan.
              </caption>
              <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Tier
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Revealed clues
                  </th>
                </tr>
              </thead>
              <tbody>
                {CLUE_TIERS.map((tier) => (
                  <tr key={tier} className="border-t border-line/60">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                      {TIER_DISPLAY_NAMES[tier]}
                    </th>
                    <td className="px-3 py-2 text-ink">{fmtCount(clueUsage.get(tier) ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="recent-rounds">
          <h2 id="recent-rounds" className="text-xl font-semibold tracking-tight text-ink">
            Recent rounds
          </h2>
          <RecentRoundsTable page={roundsPageNum} />
        </section>

        <section aria-labelledby="recent-guesses">
          <h2 id="recent-guesses" className="text-xl font-semibold tracking-tight text-ink">
            Recent guesses
          </h2>
          <RecentGuessesTable page={guessesPageNum} />
        </section>
      </div>
    </>
  );
}
