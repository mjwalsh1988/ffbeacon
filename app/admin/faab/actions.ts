"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { bustMemo } from "@/lib/memo-ttl";
import { CACHE_TAGS } from "@/lib/cache-tags";
import {
  validateFaabSettings,
  FAAB_SETTINGS_ID,
  loadFaabSettings,
} from "@/lib/faab/settings";
import { runFaabPriors } from "@/lib/faab/priors-incremental";
import { loadPriorCellsForReplay, loadReplayAuctions } from "@/lib/faab/replay-load";
import {
  replayAuctions,
  replayOptionsFrom,
  type ReplaySummary,
} from "@/lib/faab/replay";
import type { Json } from "@/lib/database.types";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the FAAB calculator settings (single global row). Admin-only and
 * validated server-side: the client payload is never trusted: it must pass the
 * full zod schema before it is written via the service-role client.
 */
export async function saveFaabSettings(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/faab");

  const validated = validateFaabSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const { error } = await admin.from("faab_calculator_settings").upsert(
    {
      id: FAAB_SETTINGS_ID,
      settings: validated.settings as unknown as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };

  bustMemo("settings:faab");
  revalidatePath("/admin/faab");
  revalidatePath("/tools/faab");
  return { ok: true };
}

export type PriorsRebuildActionResult =
  | {
      ok: true;
      /** True when the full pass finished inside this request and the cells were rebuilt. */
      complete: boolean;
      cells: number;
      auctions: number;
      leaguesRead: number;
      deleted: number;
      ms: number;
      builtAt: string;
    }
  | { ok: false; error: string };

/** What one click may spend before handing the rest to the hourly job. */
const ADMIN_REBUILD_BUDGET_MS = 240_000;

/**
 * Start a FULL rebuild of the FAAB clearing-price cells.
 *
 * The hourly faab-priors cron keeps the cells current incrementally, so this
 * is for the case the incremental pass cannot see: a change to the build
 * logic, or a league whose budget changed without any waiver row changing.
 * It walks every league of this season and last, as far as one request's
 * budget allows; whatever is left is finished by the next hourly tick, which
 * resumes the same pass. The cells keep serving the previous build until the
 * pass completes. Changing the minimum sample size needs no rebuild at all:
 * it is applied when the cells are read.
 *
 * Admin-only on the same terms as saveFaabSettings: requireAdmin first, then a
 * service-role client, because faab_market_priors gives anon and authenticated
 * SELECT and nothing else. It takes no input from the client.
 */
export async function rebuildFaabPriors(): Promise<PriorsRebuildActionResult> {
  await requireAdmin("/admin/faab");

  const admin = createAdminClient();
  try {
    const result = await runFaabPriors(admin, {
      budgetMs: ADMIN_REBUILD_BUDGET_MS,
      forceFull: true,
    });
    if (result.skipped) {
      return {
        ok: false,
        error: "The hourly FAAB price job is running right now. Try again in a few minutes.",
      };
    }
    if (result.wroteCells) revalidateTag(CACHE_TAGS.faabPriors);
    revalidatePath("/admin/faab");
    revalidatePath("/tools/faab");
    return {
      ok: true,
      complete: !result.partial,
      cells: result.cells.reduce((n, c) => n + c.cells, 0),
      auctions: result.cells.reduce((n, c) => n + c.auctions, 0),
      leaguesRead: result.pass?.leaguesRead ?? 0,
      deleted: result.cells.reduce((n, c) => n + c.deleted, 0),
      ms: result.durationMs,
      builtAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The rebuild failed.",
    };
  }
}

export type ReplayActionResult =
  | { ok: true; summary: ReplaySummary; cells: number; auctions: number; ms: number }
  | { ok: false; error: string };

/**
 * Replay the price model against every settled auction we hold.
 *
 * Reads only: it writes nothing and syncs nothing, which is why it carries no
 * revalidation. The same work `npm run faab:replay` prints, run from the admin
 * panel so a settings change can be checked without a terminal.
 *
 * Admin-only on the same terms as the two actions above, and for a plainer
 * reason than usual: it reads every auction in the database and is expensive,
 * so it must never be reachable by anyone who is not signed in as an admin.
 * The individual outcome rows are deliberately NOT returned. They carry league
 * ids, and the page only ever shows the aggregate buckets.
 */
export async function runFaabReplay(): Promise<ReplayActionResult> {
  await requireAdmin("/admin/faab");

  const admin = createAdminClient();
  const startedAt = Date.now();
  try {
    const settings = await loadFaabSettings(admin);
    const [cells, auctions] = await Promise.all([
      loadPriorCellsForReplay(admin, settings.priors.minCellSamples),
      loadReplayAuctions(admin),
    ]);
    if (cells.length === 0) {
      return {
        ok: false,
        error:
          "No market cells are stored yet. Rebuild the market data above, then run the replay.",
      };
    }
    const { summary } = replayAuctions(auctions, cells, replayOptionsFrom(settings));
    return {
      ok: true,
      summary,
      cells: cells.length,
      auctions: auctions.length,
      ms: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The replay failed.",
    };
  }
}
