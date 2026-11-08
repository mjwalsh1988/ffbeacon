import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { addDays, currentEasternGameDate } from "@/lib/game-date";
import { settlePuzzle, type SettleSummary } from "@/lib/long-shot/settle";
import { loadLongShotSettings } from "@/lib/long-shot/settings";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUN_BUDGET_MS = 280_000;
/** Do not start a new puzzle with less than this left; the next night finishes it. */
const START_FLOOR_MS = 60_000;
const FILM_ROOM_STALE_MS = 24 * 60 * 60 * 1000;
const FILM_ROOM_KEEP_DAYS = 30;
const TALLY_KEEP_DAYS = 90;
/** Only puzzles in this band are pruned each night, so the read stays bounded. */
const TALLY_PRUNE_BAND_DAYS = 30;

/**
 * GET /api/cron/long-shot-settle, 05:30 UTC daily (plan 10 and 17.6).
 *
 * 00:30 EST or 01:30 EDT, so the game date before has ended in both halves of
 * the year. Settles every unsettled puzzle up to yesterday, oldest first, so
 * a missed night catches up; stops before starting a puzzle when under 60
 * seconds remain (the per-attempt guard makes a partial night safe). Then
 * closes Film Room attempts left active over 24 hours, prunes Film Room
 * attempts older than 30 days and tallies for puzzles older than 90 days.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS - 20_000;
  try {
    const result = await recordCronRun(
      admin,
      "long-shot-settle",
      async () => {
        const settings = await loadLongShotSettings(admin);
        const today = currentEasternGameDate();
        const target = addDays(today, -1);
        const { data: puzzles, error } = await admin
          .from("long_shot_puzzles")
          .select("id, game_date, prompt_count")
          .lte("game_date", target)
          .is("settled_at", null)
          .order("game_date", { ascending: true });
        if (error) throw new Error(`unsettled puzzle read failed: ${error.message}`);

        const settled: SettleSummary[] = [];
        let stoppedEarly = false;
        for (const p of puzzles ?? []) {
          if (deadline - Date.now() < START_FLOOR_MS) {
            stoppedEarly = true;
            break;
          }
          settled.push(await settlePuzzle(admin, p, settings, deadline));
        }

        // Film Room left running for a day is closed; nothing about it is tracked.
        const staleBefore = new Date(Date.now() - FILM_ROOM_STALE_MS).toISOString();
        const { error: staleErr } = await admin
          .from("long_shot_attempts")
          .update({ status: "abandoned" })
          .eq("mode", "film_room")
          .eq("status", "active")
          .lt("started_at", staleBefore);
        if (staleErr) throw new Error(`film room close failed: ${staleErr.message}`);

        const filmCutoff = new Date(Date.now() - FILM_ROOM_KEEP_DAYS * 86_400_000).toISOString();
        const { error: pruneErr } = await admin
          .from("long_shot_attempts")
          .delete()
          .eq("mode", "film_room")
          .lt("started_at", filmCutoff);
        if (pruneErr) throw new Error(`film room prune failed: ${pruneErr.message}`);

        // Tallies for old puzzles: PostgREST has no delete-by-subselect, so read
        // the old prompt ids (paged) and delete in chunks.
        const tallyCutoff = addDays(today, -TALLY_KEEP_DAYS);
        const oldPrompts = await fetchAllRows<{ id: string }>("long shot old prompts", (from, to) =>
          admin
            .from("long_shot_prompts")
            .select("id, long_shot_puzzles!inner(game_date)")
            .lt("long_shot_puzzles.game_date", tallyCutoff)
            .gte("long_shot_puzzles.game_date", addDays(tallyCutoff, -TALLY_PRUNE_BAND_DAYS))
            .order("id", { ascending: true })
            .range(from, to),
        );
        for (let i = 0; i < oldPrompts.length; i += 200) {
          const { error: tErr } = await admin
            .from("long_shot_answer_tallies")
            .delete()
            .in(
              "prompt_id",
              oldPrompts.slice(i, i + 200).map((p) => p.id),
            );
          if (tErr) throw new Error(`tally prune failed: ${tErr.message}`);
        }

        const partial = stoppedEarly || settled.some((s) => s.partial);
        return {
          target,
          settled,
          prunedTallyPrompts: oldPrompts.length,
          ...(partial ? { failedSteps: ["settlement stopped at its time budget; the next run finishes it"] } : {}),
          ...((puzzles ?? []).length === 0 ? { skipped: true } : {}),
        };
      },
      { timeoutMs: RUN_BUDGET_MS },
    );
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[long-shot-settle] failed", err);
    return NextResponse.json({ ok: false, error: "settle failed" }, { status: 500 });
  }
}
