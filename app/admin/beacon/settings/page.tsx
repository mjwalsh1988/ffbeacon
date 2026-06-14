import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { SettingField, type SettingRow } from "@/components/admin/setting-field";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const GROUPS: Array<{ category: string; title: string; description: string }> = [
  { category: "factor", title: "Adjustment factor clamp", description: "Bounds the combined adjustment factor before the band clamp." },
  { category: "staleness", title: "Source staleness thresholds", description: "How old a source's newest snapshot may be before it drops from the blend." },
  { category: "normalization", title: "Normalization", description: "How source values are aligned before blending." },
  { category: "derivation", title: "TEP derivation", description: "Controls the per-TE TE-premium boost used to derive dynasty-ppr-tep." },
  { category: "ai", title: "AI signal", description: "The ai_adjust signal: a bounded per-player nudge from the model. The system prompt below is the exact template sent on every call; edit it to review or change what the AI receives. Off by default (set AI signal enabled to On and enable the ai_adjust weight to activate)." },
];

export default async function BeaconSettingsPage() {
  await requireAdmin("/admin/beacon/settings");
  const admin = createAdminClient();
  const [{ data: settings }, recompute] = await Promise.all([
    admin.from("beacon_settings").select("key, value, value_type, category, label, description"),
    getRecomputeStatus(admin, Date.now()),
  ]);
  const rows = (settings ?? []) as SettingRow[];
  const byCategory = new Map<string, SettingRow[]>();
  for (const s of rows) {
    const arr = byCategory.get(s.category) ?? [];
    arr.push(s);
    byCategory.set(s.category, arr);
  }

  return (
    <BeaconPageShell
      title="Settings"
      description="Engine-wide tunables, grouped by area. Every value is DB-backed and applied on the next recompute."
      recompute={recompute}
    >
      <div className="space-y-10">
        {GROUPS.map((g) => {
          const items = byCategory.get(g.category);
          if (!items || items.length === 0) return null;
          return (
            <section key={g.category} aria-labelledby={`grp-${g.category}`}>
              <h3 id={`grp-${g.category}`} className="text-lg font-semibold tracking-tight text-ink">{g.title}</h3>
              <p className="mt-1 mb-4 text-sm text-ink-muted">{g.description}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((s) => (
                  <SettingField
                    key={s.key}
                    setting={s}
                    options={s.key === "normalization_method" ? ["quantile_median", "p99_scale"] : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </BeaconPageShell>
  );
}
