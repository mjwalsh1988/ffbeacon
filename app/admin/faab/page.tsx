import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadFaabSettings } from "@/lib/faab/settings";
import { FaabSettingsManager } from "./faab-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "FAAB Calculator" };

export default async function FaabAdminPage() {
  await requireAdmin("/admin/faab");
  const admin = createAdminClient();
  const settings = await loadFaabSettings(admin);

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
      <FaabSettingsManager initialSettings={settings} />
    </div>
  );
}
