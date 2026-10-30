import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadLeagueBlueprintSettings } from "@/lib/league-blueprint/settings";
import { BlueprintSettingsManager } from "./blueprint-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Team Blueprint settings" };

export default async function LeagueBlueprintAdminPage() {
  await requireAdmin("/admin/league-blueprint");
  const admin = createAdminClient();
  const settings = await loadLeagueBlueprintSettings(admin);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Team Blueprint settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Every threshold and weight behind the Team Blueprint page in League Pulse: the grades,
        the archetypes, the buy, sell and hold calls, the trade activity gauge, the trade shapes
        and the partner scoring. Saving does not rebuild any blueprint. Each one rebuilds on its
        next view when its cache lapses, or at once when you raise the version. A missing or
        broken value falls back to the code default.
      </p>
      <BlueprintSettingsManager initialSettings={settings} />
    </div>
  );
}
