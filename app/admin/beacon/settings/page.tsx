import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { SettingField, type SettingRow } from "@/components/admin/setting-field";
import { AiModelField } from "@/components/admin/ai-model-field";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const GROUPS: Array<{ category: string; title: string; description: string }> = [
  { category: "factor", title: "How far signals can move a value", description: "After sources are blended, the performance and AI signals nudge each value up or down. These two numbers are the guardrail on how far that nudge can go, applied just before each position's value band is enforced." },
  { category: "staleness", title: "When to stop trusting a source", description: "If a source has not refreshed in this many days, we drop it from the blend until it updates again, so old data never quietly drags values around." },
  { category: "normalization", title: "Putting sources on one scale", description: "Every source uses its own numbering. These settings control how we rescale them all onto one common 0 to 10000 curve so they can be averaged fairly before blending." },
  { category: "derivation", title: "Tight-end-premium boost", description: "The tight-end-premium format (dynasty-ppr-tep) gives tight ends extra value. These settings control how big that per-TE boost can be and which TEs qualify for it." },
  { category: "ai", title: "AI signal", description: "An optional, tightly bounded per-player nudge from an Anthropic model, layered on top of the blended value. It is Off by default. To turn it on you need this master switch (AI signal enabled) set to On AND the ai_adjust weight enabled on the Signal weights page. The system prompt below is the exact text sent to the model on every call." },
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
      description="The engine-wide knobs, grouped by what they affect. Each card explains in plain terms how changing that value shifts FF Beacon values. Changes are saved immediately and take effect on the next recompute."
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
                {items.map((s) =>
                  s.key === "ai_model" ? (
                    <AiModelField key={s.key} setting={s} />
                  ) : (
                    <SettingField
                      key={s.key}
                      setting={s}
                      options={s.key === "normalization_method" ? ["quantile_median", "p99_scale"] : undefined}
                    />
                  ),
                )}
              </div>
            </section>
          );
        })}
      </div>
    </BeaconPageShell>
  );
}
