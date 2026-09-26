import "server-only";

/**
 * Everything the builder screen needs for one run, in one object: the setup,
 * the answer log, card data for every player the run can show, FF Beacon's
 * ranks for the result line, and a guest's limits. Built by the start action
 * and by the page when it resumes a run, so the two cannot disagree.
 *
 * Card data for the WHOLE seed is sent once, so the page never waits on the
 * network between two questions: an answer is folded in the browser at once
 * and confirmed by the server behind it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { loadCardPlayers } from "./card";
import type { CardPlayer } from "./card-text";
import { loadBeaconComparison } from "./beacon-comparison";
import type { RankComparison } from "./compare";
import type { Answer } from "./builder";
import type { LoadedRun, StoredSetup } from "./run-store";
import type { RankingBuilderSettings } from "./default-settings";

const REGULAR_SEASON_WEEKS = 18;

export type RunRef = { kind: "board"; boardId: string } | { kind: "guest" };

export type RunPayload = {
  ref: RunRef;
  setup: StoredSetup;
  answers: Answer[];
  cards: Record<string, CardPlayer>;
  comparison: RankComparison | null;
  comparisonNote: string;
  settings: {
    keepGoingStep: number;
    checkpointEvery: number;
    maxDepth: number;
    agreementWindow: number;
  };
  /** True once this run's format has a published community board, which is
   * when the finished run links to it (plan 4.1). */
  communityPublished: boolean;
  guest: { retentionHours: number; expiresAt: string | null } | null;
};

/** The newest season that has finished: the one before the season in
 * progress, or the current one once its regular season is over. */
export async function lastCompletedSeason(admin: SupabaseClient<Database>): Promise<number> {
  const clock = await resolveSeasonClock(admin);
  if (clock.season == null) return new Date().getUTCFullYear() - 1;
  return clock.currentWeek > REGULAR_SEASON_WEEKS ? clock.season : clock.season - 1;
}

export async function buildRunPayload(
  run: LoadedRun,
  settings: RankingBuilderSettings,
  opts: { communityPublished: boolean } = { communityPublished: false },
): Promise<RunPayload> {
  const setup = run.setup;
  const ids = [...new Set([...setup.initialBoard, ...setup.seed, ...setup.secondPass])];
  const read = createCachedReadClient();
  const [cards, beacon] = await Promise.all([
    loadCardPlayers(read, ids, {
      scoringType: setup.meta.scoringType,
      lastCompletedSeason: setup.meta.lastCompletedSeason,
    }),
    loadBeaconComparison(read, {
      scope: setup.meta.scope,
      boardFormatSlug: setup.meta.formatSlug,
      readerFormatSlug: setup.meta.formatSlug,
      restrictTo: ids,
    }),
  ]);
  return {
    ref: run.kind === "board" ? { kind: "board", boardId: run.boardId } : { kind: "guest" },
    setup,
    answers: run.answers,
    cards,
    comparison: beacon.comparison,
    comparisonNote: beacon.note,
    settings: {
      keepGoingStep: settings.builder.keepGoingStep,
      checkpointEvery: settings.builder.checkpointEvery,
      maxDepth: settings.builder.maxDepth,
      agreementWindow: settings.community.agreementWindow,
    },
    communityPublished: opts.communityPublished,
    guest:
      run.kind === "guest"
        ? {
            retentionHours: settings.guests.retentionHours,
            expiresAt: new Date(
              new Date(run.updatedAt).getTime() + settings.guests.retentionHours * 3_600_000,
            ).toISOString(),
          }
        : null,
  };
}
