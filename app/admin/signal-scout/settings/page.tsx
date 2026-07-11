import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadSignalScoutSettings, SIGNAL_SCOUT_SETTINGS_ID } from "@/lib/signal-scout/settings";
import { SignalScoutSubnav } from "@/components/admin/signal-scout-subnav";
import { SignalScoutSettingsManager } from "./signal-scout-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Signal Scout Settings" };

export default async function SignalScoutSettingsPage() {
  // Independent re-check (defense in depth alongside the layout gate).
  await requireAdmin("/admin/signal-scout/settings");

  const admin = createAdminClient();
  const settings = await loadSignalScoutSettings(admin);

  // Surface when the row was last saved (display only; America/New_York
  // handled in the manager via lib/datetime). A missing row means defaults
  // are in effect.
  const { data: row } = await admin
    .from("signal_scout_settings")
    .select("updated_at")
    .eq("id", SIGNAL_SCOUT_SETTINGS_ID)
    .maybeSingle();

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Control the Signal Scout guessing game at <span className="text-ink">/games/signal-scout</span>:
          turn the game on or off, guest limits, scoring costs, clue reveal limits, the eligible
          player pool, leaderboards, and reveal behavior. Changes take effect for new rounds; a round
          already in progress keeps the settings it started with.
        </p>
      </div>

      <SignalScoutSubnav />

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <SignalScoutSettingsManager initialSettings={settings} lastUpdated={row?.updated_at ?? null} />
      </div>
    </>
  );
}
