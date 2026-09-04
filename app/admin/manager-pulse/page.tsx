import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import { ManagerPulseSubnav } from "@/components/admin/manager-pulse-subnav";
import { ManagerPulseSettingsManager } from "./manager-pulse-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manager Pulse settings" };

export default async function ManagerPulseAdminPage() {
  await requireAdmin("/admin/manager-pulse");
  const admin = createAdminClient();
  const settings = await loadManagerPulseSettings(admin);

  return (
    <>
      <ManagerPulseSubnav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Manager Pulse settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          These numbers govern what Manager Pulse fetches and what it is willing
          to claim. Saving does not recompute existing reports. Bumping the
          model version forces every report to rebuild on next view.
        </p>
        <ManagerPulseSettingsManager initialSettings={settings} />
      </div>
    </>
  );
}
