import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SITE } from "@/lib/site";
import { loadScheduleBoard, loadMatchupDetail } from "@/lib/league-schedule/data";
import { renderPlainText } from "./render";
import { loadLeagueRelaySettings } from "./settings";
import {
  loadFaabMedian,
  loadWaiverPlayers,
  readFaabBid,
  readFaabBudget,
} from "./load";
import {
  buildTradeFor,
  buildWaiverFor,
  dedupeKeyFor,
  gatherLeagueFacts,
  toWaiverMove,
  type TxParams,
  type TxRow,
} from "./relay";
import { buildWaiverDigest } from "./waiver-writeup";
import { groupIntoRuns, runDigestKey, runIsDigest } from "./waiver-run";
import { buildMatchupPreview, buildMatchupRecap } from "./matchup-writeup";
import { orderRecaps, pickMatchups, recapKeyPart } from "./select-matchup";
import type { LeagueRelaySettings, RelayMessageType } from "./default-settings";
import type { WaiverPlayer } from "./waiver-writeup";

type Admin = SupabaseClient<Database>;

/**
 * Build a writeup WITHOUT claiming anything and WITHOUT sending anything.
 *
 * WHY THIS EXISTS AND WHY IT SHARES EVERY LINE OF THE LIVE PATH. Nothing else
 * this codebase does writes prose about a real person's fantasy team and posts
 * it into a room they are in. An admin has to be able to read what would go out
 * before it goes out, and a preview built by a second, gentler code path would
 * be a promise the live path never made.
 *
 * So: same facts (`gatherLeagueFacts`), same builders, same renderer, same
 * composition and the same Discord limits. The ONLY differences are that it
 * ignores the watermark and the ledger, so an admin can preview a trade from
 * last month, and that it never touches `league_relay_posts`.
 *
 * IT ALSO IGNORES THE ENABLE FLAGS, and that is deliberate. An admin previewing
 * matchup recaps has, by definition, not turned matchup recaps on yet.
 */

export interface PreviewMessage {
  type: RelayMessageType;
  /** The key this message WOULD be recorded under, so an admin can see the dedupe. */
  dedupeKey: string;
  /** The writeup as plain text, composed exactly as Discord would receive it. */
  text: string;
  /** A one-line note about what was chosen and why. */
  note: string;
}

export interface PreviewResult {
  ok: boolean;
  leagueName: string | null;
  messages: PreviewMessage[];
  /** Why a requested type produced nothing. One line each. */
  notes: string[];
}

/**
 * Preview the most recent thing of each requested type.
 *
 * `leagueRowId` is `leagues.id`, not the Sleeper id: the caller is the admin
 * panel, which already holds the row it is looking at.
 */
export async function previewRelayMessages(
  admin: Admin,
  params: {
    leagueRowId: string;
    types: RelayMessageType[];
    /** How many of each type. Bounded by the caller; the default is one. */
    perType?: number;
    /** Overrides the stored settings, for trying a snark level before saving. */
    settings?: LeagueRelaySettings;
  },
): Promise<PreviewResult> {
  const settings = params.settings ?? (await loadLeagueRelaySettings(admin));
  const perType = Math.min(5, Math.max(1, params.perType ?? 1));
  const notes: string[] = [];
  const messages: PreviewMessage[] = [];

  // The epoch as the watermark: a preview deliberately reaches back past
  // whatever the live path would consider news.
  const facts = await gatherLeagueFacts(admin, params.leagueRowId, new Date(0).toISOString());
  if (!facts) {
    return { ok: false, leagueName: null, messages: [], notes: ["That league is not synced."] };
  }
  const { league, teams, pulseRanks, context, sleeperLeague, playoffWeekStart, currentWeek } =
    facts;

  const url = settings.voice.link_back ? `${SITE.url}/leagues/${league.sleeperLeagueId}` : null;

  /* ------------------------------------------------------ trades + waivers */
  const wantTrade = params.types.includes("trade");
  const wantWaiver = params.types.includes("waiver");
  if (wantTrade || wantWaiver) {
    const types = [
      ...(wantTrade ? ["trade"] : []),
      ...(wantWaiver ? ["waiver", "free_agent"] : []),
    ];
    const { data: rows } = await admin
      .from("league_transactions")
      .select(
        "id, sleeper_transaction_id, type, status, week, season, adds, drops, draft_picks, waiver_budget, roster_ids, metadata, created_at_sleeper",
      )
      .eq("league_id", league.id)
      .in("type", types)
      .eq("status", "complete")
      // Newest first here, unlike the live path: a preview wants the most
      // recent example, and the live path wants the oldest unhandled one.
      .order("created_at_sleeper", { ascending: false })
      // A wide window on purpose. Grouping needs enough history to find a BUSY
      // run, and the point of the preview is to show an admin both shapes: the
      // quiet run that gets reviews and the busy one that gets a digest. One
      // indexed read either way.
      .limit(200);

    const all = (rows ?? []) as unknown as TxRow[];
    const trades = all.filter((t) => t.type === "trade").slice(0, perType);

    // The wire half is grouped BEFORE it is trimmed, so a preview of a busy
    // Wednesday shows the digest the channel would actually get rather than the
    // first three claims of it reviewed one at a time.
    const wireRuns = groupIntoRuns(
      all
        .filter((t) => t.type !== "trade")
        .map((t) => ({
          sleeperTransactionId: t.sleeper_transaction_id,
          type: t.type === "waiver" ? ("waiver" as const) : ("free_agent" as const),
          createdAtSleeper: t.created_at_sleeper,
          week: t.week,
        })),
    );
    // Newest run first: a preview wants the most recent example.
    const newestFirst = [...wireRuns].reverse();
    const previewRuns = newestFirst.slice(0, perType);
    // If none of those is busy enough to digest, add the most recent one that
    // is. An admin turning this on wants to see what a Wednesday morning looks
    // like, and a league whose last few moves were single drops would otherwise
    // never show them the digest at all.
    // One per kind, because waivers and free agents group separately and an
    // admin wants to see both. Without the per-kind loop the newer of the two
    // was always the only digest shown.
    for (const kind of ["waiver", "free_agent"] as const) {
      const alreadyShown = previewRuns.some(
        (r) => r.type === kind && runIsDigest(r, settings.waivers.digest_threshold),
      );
      if (alreadyShown) continue;
      const busiest = newestFirst.find(
        (r) => r.type === kind && runIsDigest(r, settings.waivers.digest_threshold),
      );
      if (busiest) previewRuns.push(busiest);
    }
    const wireById = new Map(all.map((t) => [t.sleeper_transaction_id, t]));
    const waivers = previewRuns.flatMap((r) =>
      r.moves
        .map((m) => wireById.get(m.sleeperTransactionId))
        .filter((t): t is TxRow => Boolean(t)),
    );

    const txParams: TxParams = {
      settings,
      league,
      teams,
      pulseRanks,
      context,
      currentWeek,
      sleeperLeague,
      url,
      now: new Date(),
      dryRun: false,
      budget: perType,
    };

    for (const tx of trades) {
      const dedupeKey = dedupeKeyFor("trade", league.id, tx.sleeper_transaction_id);
      const writeup = await buildTradeFor(admin, txParams, tx, dedupeKey);
      const text = writeup ? renderPlainText(writeup) : null;
      if (text) {
        messages.push({
          type: "trade",
          dedupeKey,
          text,
          note: `Trade ${tx.sleeper_transaction_id}, week ${tx.week ?? "?"}.`,
        });
      } else {
        notes.push(
          `A trade (${tx.sleeper_transaction_id}) could not be written up: Signal Check could not grade it, or it had more than two sides.`,
        );
      }
    }
    if (wantTrade && trades.length === 0) notes.push("This league has no trades stored.");

    if (waivers.length > 0) {
      const playerIds = new Set<string>();
      for (const t of waivers) {
        for (const id of Object.keys((t.adds ?? {}) as Record<string, unknown>)) playerIds.add(id);
        for (const id of Object.keys((t.drops ?? {}) as Record<string, unknown>)) playerIds.add(id);
      }
      const weeks = [currentWeek, currentWeek + 1, currentWeek + 2].filter(
        (w) => w >= 1 && w <= 18,
      );
      const [players, faabMedian] = await Promise.all([
        loadWaiverPlayers(admin, {
          sleeperPlayerIds: Array.from(playerIds),
          season: league.season,
          weeks,
          scoring:
            (sleeperLeague as { scoring_settings?: Record<string, number> })?.scoring_settings ??
            null,
          formatConfigId: context.formatConfigId,
          sourceSlug: context.sourceSlug,
        }),
        loadFaabMedian(admin, league.id, league.season),
      ]);
      const faabBudget = readFaabBudget(sleeperLeague);
      void readFaabBid;

      // Each run takes the shape the live path would give it: reviews when it
      // is quiet, one digest when it is busy.
      for (const run of previewRuns) {
        const rows = run.moves
          .map((m) => wireById.get(m.sleeperTransactionId))
          .filter((t): t is TxRow => Boolean(t));

        if (runIsDigest(run, settings.waivers.digest_threshold)) {
          const dedupeKey = runDigestKey(league.id, run);
          const writeup = buildWaiverDigest({
            league,
            moves: rows
              .map((tx) => toWaiverMove(txParams, tx, players as Map<string, WaiverPlayer>))
              .filter((m): m is NonNullable<typeof m> => m !== null),
            kind: run.type,
            week: run.week,
            faabBudget,
            faabMedian,
            snark: settings.voice.snark,
            showNumbers: settings.voice.show_numbers,
            url,
            seedKey: dedupeKey,
          });
          const text = writeup ? renderPlainText(writeup) : null;
          if (text) {
            messages.push({
              type: "waiver",
              dedupeKey,
              text,
              note: `A run of ${run.moves.length} ${
                run.type === "waiver" ? "waiver claims" : "free agent moves"
              }, over the digest threshold of ${settings.waivers.digest_threshold}, so it becomes one message.`,
            });
          }
          continue;
        }

        for (const tx of rows) {
          const dedupeKey = dedupeKeyFor(tx.type, league.id, tx.sleeper_transaction_id);
          const writeup = buildWaiverFor(
            txParams,
            tx,
            players as Map<string, WaiverPlayer>,
            faabBudget,
            faabMedian,
            dedupeKey,
          );
          const text = writeup ? renderPlainText(writeup) : null;
          if (text) {
            messages.push({
              type: "waiver",
              dedupeKey,
              text,
              note: `${
                tx.type === "waiver" ? "Waiver claim" : "Free agent pickup"
              }, one of ${run.moves.length} in its run, so it gets a full review.`,
            });
          }
        }
      }
    } else if (wantWaiver) {
      notes.push("This league has no waiver or free agent moves stored.");
    }
  }

  /* ------------------------------------------------------------- matchups */
  const wantPreview = params.types.includes("matchup_preview");
  const wantRecap = params.types.includes("matchup_recap");
  if (wantPreview || wantRecap) {
    const board = await loadScheduleBoard(admin, {
      leagueRowId: league.id,
      season: league.season,
      playoffWeekStart,
      currentWeek,
    });

    if (board.noScheduleYet) {
      notes.push("Sleeper has not published a schedule for this league yet.");
    } else {
      if (wantPreview) {
        // The current week if it is a regular-season week; otherwise the last
        // regular-season week there is, so a preview can still be read in the
        // off season.
        const week =
          board.weeks.find((w) => w.week === currentWeek && !w.isPlayoffWeek) ??
          [...board.weeks].reverse().find((w) => !w.isPlayoffWeek);
        if (!week) {
          notes.push("No regular-season week to preview.");
        } else {
          const picks = pickMatchups(week, league.totalRosters, {
            headline: true,
            undercard: true,
          });
          for (const pick of picks.slice(0, perType + 1)) {
            const dedupeKey = `preview:${league.id}:${league.season}:${week.week}:${pick.slot}`;
            const detail = await loadMatchupDetail(admin, admin, {
              leagueRowId: league.id,
              season: league.season,
              week: week.week,
              sleeperRosterId: pick.matchup.home.sleeperRosterId,
              currentWeek,
            });
            if (!detail.ok) {
              notes.push(`Could not load the ${pick.slot} matchup for week ${week.week}.`);
              continue;
            }
            const writeup = buildMatchupPreview({
              league,
              view: detail.view,
              slot: pick.slot,
              snark: settings.voice.snark,
              showNumbers: settings.voice.show_numbers,
              url,
              seedKey: dedupeKey,
            });
            const text = writeup ? renderPlainText(writeup) : null;
            if (text) {
              messages.push({
                type: "matchup_preview",
                dedupeKey,
                text,
                note: `${pick.slot === "headline" ? "Headline" : "Undercard"}: ${pick.reason}`,
              });
            }
          }
        }
      }

      if (wantRecap) {
        const finals = board.weeks.filter((w) => w.isFinal && !w.isPlayoffWeek);
        const week = finals[finals.length - 1];
        if (!week) {
          notes.push("No finished regular-season week to recap.");
        } else {
          for (const game of orderRecaps(week).slice(0, perType)) {
            const dedupeKey = `recap:${league.id}:${league.season}:${week.week}:${recapKeyPart(
              game,
            )}`;
            const detail = await loadMatchupDetail(admin, admin, {
              leagueRowId: league.id,
              season: league.season,
              week: week.week,
              sleeperRosterId: game.home.sleeperRosterId,
              currentWeek,
            });
            if (!detail.ok) continue;
            const writeup = buildMatchupRecap({
              league,
              view: detail.view,
              slot: null,
              snark: settings.voice.snark,
              showNumbers: settings.voice.show_numbers,
              url,
              seedKey: dedupeKey,
            });
            const text = writeup ? renderPlainText(writeup) : null;
            if (text) {
              messages.push({
                type: "matchup_recap",
                dedupeKey,
                text,
                note: `Week ${week.week}, in the order Tuesday would post them.`,
              });
            }
          }
        }
      }
    }
  }

  return { ok: true, leagueName: league.name, messages, notes };
}
