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
import { rebuildFaabMarketPriors } from "@/lib/faab/priors-write";
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
      cells: number;
      auctions: number;
      leagues: number;
      deleted: number;
      ms: number;
      builtAt: string;
    }
  | { ok: false; error: string };

/**
 * Rebuild the anonymous FAAB clearing-price cells on demand.
 *
 * The nightly derived-data cron already rebuilds these when the newest cell is
 * older than the admin's staleness setting. This is the same work, run now,
 * for the admin who has just changed the minimum sample size and wants to see
 * what it did rather than wait a night for it.
 *
 * Admin-only on the same terms as saveFaabSettings: requireAdmin first, then a
 * service-role client, because faab_market_priors gives anon and authenticated
 * SELECT and nothing else. The rebuild itself never trusts client input: the
 * only knob it takes is read back out of the stored settings row.
 */
export async function rebuildFaabPriors(): Promise<PriorsRebuildActionResult> {
  await requireAdmin("/admin/faab");

  const admin = createAdminClient();
  try {
    const settings = await loadFaabSettings(admin);
    const result = await rebuildFaabMarketPriors(admin, {
      minCellSamples: settings.priors.minCellSamples,
    });
    revalidateTag(CACHE_TAGS.faabPriors);
    revalidatePath("/admin/faab");
    revalidatePath("/tools/faab");
    return { ok: true, ...result, builtAt: new Date().toISOString() };
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
      loadPriorCellsForReplay(admin),
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
