import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadFaabSettings } from "@/lib/faab/settings";
import { priorsBuiltAt } from "@/lib/faab/priors-write";
import { FaabSettingsManager, type PriorsStatus } from "./faab-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "FAAB Calculator" };

/**
 * How many cells the market priors table holds, how many leagues fed them and
 * when they were last built.
 *
 * Service role, because faab_market_priors is readable by anon but the admin
 * page is already running as the service role for the settings row and this
 * keeps the two reads on one client. `leagues_count` is stored per cell, so the
 * league total is the largest of them: the rolled-up "any" cell covers every
 * league that contributed anything.
 *
 * Never throws. A failed read means the line reads "not built yet", which is
 * the honest answer when we cannot say otherwise, and the rest of the page
 * still renders.
 */
async function loadPriorsStatus(
  admin: ReturnType<typeof createAdminClient>,
): Promise<PriorsStatus> {
  try {
    const [builtAt, cells, leagues] = await Promise.all([
      priorsBuiltAt(admin),
      admin
        .from("faab_market_priors")
        .select("id", { count: "exact", head: true }),
      admin
        .from("faab_market_priors")
        .select("leagues_count")
        .order("leagues_count", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      builtAt: builtAt ? builtAt.toISOString() : null,
      cells: cells.count ?? 0,
      leagues: leagues.data?.leagues_count ?? 0,
    };
  } catch {
    return { builtAt: null, cells: 0, leagues: 0 };
  }
}

export default async function FaabAdminPage() {
  await requireAdmin("/admin/faab");
  const admin = createAdminClient();
  const [settings, priorsStatus] = await Promise.all([
    loadFaabSettings(admin),
    loadPriorsStatus(admin),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        FAAB Calculator
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Tune the public FAAB strategy calculator. These settings drive the bid
        curve, league-depth adjustments, need multipliers, the dynamic dump
        mechanic, value normalization, and the on-page copy. Changes apply
        immediately. The calculator falls back to safe code defaults if a value
        is ever missing.
      </p>
      <FaabSettingsManager
        initialSettings={settings}
        initialPriorsStatus={priorsStatus}
      />
    </div>
  );
}
