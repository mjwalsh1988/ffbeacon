import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import { BeaconRankerSettingsManager } from "./beacon-ranker-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Beacon Ranker settings" };

export default async function BeaconRankerAdminPage() {
  await requireAdmin("/admin/beacon-ranker");
  const admin = createAdminClient();
  const settings = await loadRankingBuilderSettings(admin);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Beacon Ranker settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        The rankings builder at /tools/custom-rankings and the community rankings both read these
        numbers. Saving affects new runs and the next nightly community build.
      </p>
      <BeaconRankerSettingsManager initialSettings={settings} />
    </div>
  );
}
