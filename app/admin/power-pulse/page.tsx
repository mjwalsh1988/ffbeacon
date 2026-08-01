import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { PowerPulseSettingsManager } from "./power-pulse-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Power Pulse model" };

export default async function PowerPulseAdminPage() {
  await requireAdmin("/admin/power-pulse");
  const admin = createAdminClient();
  const settings = await loadPowerPulseSettings(admin);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Power Pulse model
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Every weight, cap, and toggle behind the Power Pulse score on the League
        Pulse deep view. Saving does not recompute existing leagues: each one
        rescores on its next view when its cache goes stale, or immediately if
        you change the model version. The engine falls back to safe code defaults
        if a value is ever missing.
      </p>
      <PowerPulseSettingsManager initialSettings={settings} />
    </div>
  );
}
