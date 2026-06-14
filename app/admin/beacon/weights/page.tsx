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
      description="Weight, confidence cap, and enable toggle for each signal and source. Higher weight gives a signal more pull on the blend."
      recompute={recompute}
    >
      <SignalWeightsTable weights={(weights ?? []) as never} />
    </BeaconPageShell>
  );
}
