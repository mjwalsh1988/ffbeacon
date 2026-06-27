import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { OnTheClockSettingsManager } from "./on-the-clock-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "On The Clock Settings" };

export default async function OnTheClockAdminPage() {
  await requireAdmin("/admin/on-the-clock");
  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);

  // Surface when the row was last saved (display only; America/New_York handled in
  // the manager via lib/datetime). A missing row means defaults are in effect.
  const { data: row } = await admin
    .from("on_the_clock_settings")
    .select("updated_at")
    .eq("id", "global")
    .maybeSingle();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">On The Clock Settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Control the live draft helper at <span className="text-ink">/tools/on-the-clock</span>: turn
        the tool on or off, set how often it can refresh from Sleeper, and tune the Best Available and
        Team Need recommendations. Changes apply immediately. If a value is ever missing or invalid,
        the tool falls back to safe defaults so it never breaks.
      </p>
      <OnTheClockSettingsManager
        initialSettings={settings}
        lastUpdated={row?.updated_at ?? null}
      />
    </div>
  );
}
