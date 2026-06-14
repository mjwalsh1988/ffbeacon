import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { SignalWeightsTable } from "@/components/admin/signal-weights-table";

export const metadata: Metadata = { title: "Signal weights" };
export const dynamic = "force-dynamic";

export default async function BeaconWeightsPage() {
  await requireAdmin("/admin/beacon/weights");
  const admin = createAdminClient();
  const [{ data: weights }, recompute] = await Promise.all([
    admin
      .from("beacon_signal_weights")
      .select("id, signal_type, source_slug, weight, confidence_cap, is_enabled")
      .order("signal_type"),
    getRecomputeStatus(admin, Date.now()),
  ]);

  return (
    <BeaconPageShell
      title="Signal weights"
      description="Each row is one input the engine can use. Weight is how much pull it has (higher means more influence on the final value). Confidence cap is the ceiling on how much an adjustment signal is trusted even when it is very sure. Enabled turns the input on or off entirely. Source rows feed the base blend; the stat_performance and ai_adjust rows are the signals that then nudge that blend up or down."
      recompute={recompute}
    >
      <SignalWeightsTable weights={(weights ?? []) as never} />
    </BeaconPageShell>
  );
}
