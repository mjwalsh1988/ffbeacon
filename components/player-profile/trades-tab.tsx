/**
 * Trades tab: every trade across all synced leagues that includes this player,
 * each rendered with its FULL Signal Check grade (verdict, value margin,
 * confidence, trade shape, plain-language read) via the same pipeline the League
 * Pulse transactions feed uses. Trades are grouped by league and graded once per
 * league (analyzeLeagueTrades grades two-team trades). A trade that cannot be
 * graded (not two-team, unmatched player, picks in a redraft format) falls back
 * to the minimal what-for-what card so nothing is dropped.
 *
 * Note: each trade is graded in ITS OWN league's format (that is the format the
 * trade actually happened in), not the profile's global header format. Only the
 * value source follows the user. This mirrors how in-league transactions grade.
 * Async server component.
 */

import { ArrowLeftRight, AlertTriangle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { PageBody } from "@/components/app-shell/page-body";
import { Panel } from "@/components/dashboard-panel";
import { SignalCheckTradeCard } from "@/components/signal-check-trade-card";
import { MiniTrade } from "@/components/player-profile/mini-trade";
import { type PlayerTrade } from "@/lib/player-trades";
import { findPlayerTradesCached } from "@/lib/player-profile-cache";
import { analyzeLeagueTrades, type LeagueTradeSignalCheck } from "@/lib/league-signal-check";
import type { SleeperLeague } from "@/lib/sleeper";
import { formatEastern } from "@/lib/datetime";
import type { PlayerContext, PlayerRow } from "@/lib/player-profile";

function Shell({ children }: { children: React.ReactNode }) {
  return <PageBody>{children}</PageBody>;
}

export async function TradesTab({
  player,
  sleeperId,
  context,
}: {
  player: PlayerRow;
  sleeperId: string | null;
  context: PlayerContext;
}) {
  void player;
  void context;

  if (!sleeperId) {
    return (
      <Shell>
        <Panel eyebrow="Market" title="Trades">
          <EmptyState message="We could not resolve this player to a Sleeper id, so trades cannot be looked up." />
        </Panel>
      </Shell>
    );
  }

  try {
    const admin = createAdminClient();

    // Cached lookup (public tables only). The Signal Check grading below reads
    // service-role config per request and stays uncached.
    const trades = await findPlayerTradesCached(sleeperId, 30);
    if (trades.length === 0) {
      return (
        <Shell>
          <Panel eyebrow="Market" title="Trades">
            <EmptyState message="No trades in our system include this player yet." />
          </Panel>
        </Shell>
      );
    }

    // Group by league so each league is graded in a single batched pass.
    const byLeague = new Map<string, PlayerTrade[]>();
    for (const t of trades) {
      const list = byLeague.get(t.leagueRowId);
      if (list) list.push(t);
      else byLeague.set(t.leagueRowId, [t]);
    }

    // Raw Sleeper league objects (leagues.metadata) drive format derivation.
    const { data: leagueRows } = await admin
      .from("leagues")
      .select("id, metadata")
      .in("id", Array.from(byLeague.keys()));
    const metaById = new Map((leagueRows ?? []).map((l) => [l.id, l.metadata]));

    // Grade every league group. A single failing league never blocks the others.
    const graded = new Map<string, LeagueTradeSignalCheck>();
    await Promise.all(
      Array.from(byLeague.entries()).map(async ([leagueRowId, group]) => {
        const meta = metaById.get(leagueRowId);
        if (!meta) return;
        const rosterLabels: Record<number, string> = {};
        for (const t of group) for (const s of t.sides) rosterLabels[s.rosterId] = s.teamName;
        try {
          const analysis = await analyzeLeagueTrades(admin, {
            sleeperLeague: meta as unknown as SleeperLeague,
            trades: group.map((t) => ({
              sleeperTransactionId: t.transactionId,
              adds: t.raw.adds,
              draftPicks: t.raw.draftPicks,
            })),
            rosterLabels,
            leagueRowId,
          });
          for (const [txId, view] of analysis.results) graded.set(txId, view);
        } catch (err) {
          console.error("[player trades] league grade failed", leagueRowId, err);
        }
      }),
    );

    const gradedCount = trades.filter((t) => graded.has(t.transactionId)).length;

    return (
      <Shell>
        <Panel
          eyebrow="Market"
          title="Trades across the ecosystem"
          helper={
            gradedCount > 0
              ? "Each trade is graded by Signal Check in its own league's format using FF Beacon values."
              : "Trades involving this player from every synced league."
          }
          bodyClassName="p-4 sm:p-5"
        >
          <ol className="space-y-5" role="list" aria-label={`Trades involving this player`}>
            {trades.map((t) => {
              const view = graded.get(t.transactionId);
              return (
                <li key={`${t.leagueRowId}-${t.transactionId}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
                    <span className="font-medium text-ink-muted">{t.leagueName ?? "League trade"}</span>
                    {t.season != null && <span>{t.season} season</span>}
                  </div>
                  {view ? (
                    <SignalCheckTradeCard
                      view={view.view}
                      assetMeta={view.assetMeta}
                      sleeperLeagueId={t.sleeperLeagueId ?? ""}
                      sleeperTransactionId={t.transactionId}
                      week={t.week}
                      createdAtSleeper={t.createdAtSleeper}
                      status={null}
                    />
                  ) : (
                    <div className="rounded-modal border border-line bg-surface/50 p-4">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
                        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                        Full grade unavailable for this trade{t.isTwoTeam ? "" : " (not a two-team trade)"}
                        {t.createdAtSleeper ? `, ${formatEastern(t.createdAtSleeper)}` : ""}
                      </p>
                      <MiniTrade trade={t} focusSleeperId={sleeperId} nowMs={Date.now()} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
      </Shell>
    );
  } catch (err) {
    console.error("[player trades] tab failed", err);
    return (
      <Shell>
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>We could not load trades for this player right now. Please try again shortly.</p>
        </div>
      </Shell>
    );
  }
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-dashed border-line bg-base/40 p-6">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <ArrowLeftRight className="h-5 w-5" />
      </span>
      <p className="text-sm leading-relaxed text-ink-muted">{message}</p>
    </div>
  );
}
