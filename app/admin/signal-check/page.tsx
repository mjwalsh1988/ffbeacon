import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { SettingField, type SettingRow } from "@/components/admin/setting-field";
import { updateSignalCheckSetting } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: { key: string; title: string; blurb: string }[] = [
  { key: "signal_check", title: "General", blurb: "Master switch, labels, display, and public toggles." },
  { key: "signal_check_verdict", title: "Verdict", blurb: "Neutral and blowout thresholds, wording, and compounding mode." },
  { key: "signal_check_pileon", title: "Pile-on", blurb: "Diminishing returns on depth pieces (once per side)." },
  { key: "signal_check_shape", title: "Trade shape", blurb: "Shape detection thresholds and the public label for each shape." },
  { key: "signal_check_confidence", title: "Confidence", blurb: "Confidence scoring thresholds and labels." },
  { key: "signal_check_format", title: "Value and format", blurb: "Default format, hidden formats, and the Sleeper override policy." },
];

export default async function SignalCheckAdminPage() {
  await requireAdmin("/admin/signal-check");
  const admin = createAdminClient();
  const { data } = await admin
    .from("beacon_settings")
    .select("key, value, value_type, category, label, description")
    .like("category", "signal_check%")
    .order("key", { ascending: true });

  const rows = (data ?? []) as SettingRow[];
  const byCategory = new Map<string, SettingRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Signal Check</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Tune the public Signal Check trade analyzer. Changes apply immediately and are recorded in
        the Signal Check audit log. Calibration rules and the regression set are managed separately.
      </p>

      <div className="mt-8 space-y-10">
        {CATEGORY_ORDER.map((cat) => {
          const group = byCategory.get(cat.key) ?? [];
          if (group.length === 0) return null;
          return (
            <section key={cat.key} aria-labelledby={`${cat.key}-heading`}>
              <h2 id={`${cat.key}-heading`} className="text-lg font-semibold text-ink">
                {cat.title}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{cat.blurb}</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.map((setting) => (
                  <SettingField
                    key={setting.key}
                    setting={setting}
                    action={updateSignalCheckSetting}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
