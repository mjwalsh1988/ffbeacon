import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BriefDeskPageShell } from "@/components/admin/brief-desk-page-shell";
import { SettingField, type SettingRow } from "@/components/admin/setting-field";
import { updateBriefDeskSetting } from "@/app/admin/brief-desk/actions";
import { briefDeskTokenPresent } from "@/lib/brief-desk/auth";
import { BRIEF_DESK_SETTING_KEYS } from "@/lib/brief-desk/settings";
import { loadDeskActivity } from "@/lib/brief-desk/desk-activity";
import { formatEastern } from "@/lib/datetime";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** The brief_desk keys in their declared order, then the one legacy toggle. */
const ORDER: readonly string[] = [...BRIEF_DESK_SETTING_KEYS, "bb_article_write_enabled"];

export default async function BriefDeskSettingsPage() {
  await requireAdmin("/admin/brief-desk/settings");
  const admin = createAdminClient();
  const [{ data: settings }, activity] = await Promise.all([
    admin
      .from("beacon_settings")
      .select("key, value, value_type, category, label, description")
      .or("category.eq.brief_desk,key.eq.bb_article_write_enabled"),
    loadDeskActivity(admin),
  ]);

  const byKey = new Map<string, SettingRow>();
  for (const s of (settings ?? []) as SettingRow[]) byKey.set(s.key, s);
  const ordered = ORDER.map((k) => byKey.get(k)).filter((s): s is SettingRow => Boolean(s));
  const tokenSet = briefDeskTokenPresent();
  const entry = (e: { at: string; message: string } | null) =>
    e ? `${formatEastern(e.at)}: ${e.message}` : "none recorded yet";

  return (
    <BriefDeskPageShell
      title="Settings"
      description="The Brief desk controls: whether the bundle endpoint answers due, the cadence and close time, the off-season minimum, Discord posting for approved editions, the Relay headline cap, the editorial instructions the desk run reads, and the Relay extraction prompt. Changes save immediately."
    >
      <div className="space-y-6">
        <section aria-labelledby="bd-status">
          <h2 id="bd-status" className="text-lg font-semibold tracking-tight text-ink">
            Desk status
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className={`rounded-card border p-4 ${tokenSet ? "border-line bg-surface/60" : "border-signal-danger/60 bg-signal-danger/10"}`}>
              <dt className="text-sm font-medium text-ink">BRIEF_DESK_TOKEN</dt>
              <dd className={`mt-1 text-sm ${tokenSet ? "text-ink-muted" : "text-signal-danger"}`}>
                {tokenSet ? "Set: yes" : "Set: no. Both desk routes fail closed until it is."}
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <dt className="text-sm font-medium text-ink">Last bundle request</dt>
              <dd className="mt-1 text-sm text-ink-muted">{entry(activity.lastBundle)}</dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <dt className="text-sm font-medium text-ink">Last draft received</dt>
              <dd className="mt-1 text-sm text-ink-muted">{entry(activity.lastDraft)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="bd-fields">
          <h2 id="bd-fields" className="text-lg font-semibold tracking-tight text-ink">
            Fields
          </h2>
          {ordered.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No brief_desk settings rows found. Apply migration 0285.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {ordered.map((s) => (
                <SettingField key={s.key} setting={s} action={updateBriefDeskSetting} />
              ))}
            </div>
          )}
        </section>
      </div>
    </BriefDeskPageShell>
  );
}
