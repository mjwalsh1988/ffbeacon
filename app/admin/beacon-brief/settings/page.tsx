import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  SettingField,
  type SettingRow,
} from "@/components/admin/setting-field";
import {
  WebhookSelectField,
  type WebhookOption,
} from "@/components/admin/beacon-brief/webhook-select-field";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

// Render order: toggles + knobs first, then the editable prompts (longer fields).
const ORDER = [
  "bb_enabled",
  "bb_discord_enabled",
  "bb_web_search_enabled",
  "bb_research_max_searches",
  "bb_autopublish",
  "bb_context_threshold",
  "bb_followup_lookback_hours",
  "bb_event_key_window_hours",
  "bb_merge_gate_enabled",
  "bb_merge_block_relevance_tier",
  "bb_player_article_cap_per_day",
  "bb_patch_max_age_minutes",
  "bb_queue_max_attempts",
  "bb_discord_jobs_per_run",
  "bb_article_jobs_per_run",
  "bb_backfill_count",
  "bb_max_items_per_run",
  "bb_max_post_age_minutes",
  "bb_worker_max_runtime_ms",
  "bb_stale_processing_minutes",
  "bb_discord_pace_ms",
  "bb_match_similarity_threshold",
  "bb_match_candidate_limit",
  "bb_keyword_filter_enabled",
  "bb_non_football_filter_enabled",
  "bb_relevance_filter_enabled",
  "bb_relevance_threshold",
  "bb_keyword_filter",
  "bb_model_article",
  "bb_model_triage",
  "bb_model_merge_rewrite",
  "bb_webhook_id",
  "bb_categorize_prompt",
  "bb_article_research_prompt",
  "bb_article_prompt",
  "bb_merge_gate_prompt",
  "bb_revision_rewrite_prompt",
  "bb_followup_link_prompt",
];

export default async function BeaconBriefSettingsPage() {
  await requireAdmin("/admin/beacon-brief/settings");
  const admin = createAdminClient();
  const [{ data: settings }, { data: webhookRows }] = await Promise.all([
    admin
      .from("beacon_settings")
      .select("key, value, value_type, category, label, description")
      .eq("category", "beacon_brief"),
    admin
      .from("discord_webhooks")
      .select("id, label, is_active")
      .order("created_at", { ascending: true }),
  ]);

  const byKey = new Map<string, SettingRow>();
  for (const s of (settings ?? []) as SettingRow[]) byKey.set(s.key, s);
  const ordered = ORDER.map((k) => byKey.get(k)).filter((s): s is SettingRow =>
    Boolean(s),
  );
  const webhooks: WebhookOption[] = (webhookRows ?? []) as WebhookOption[];

  return (
    <BeaconBriefPageShell
      title="Settings"
      description="Every Beacon Brief control. Toggles, models, thresholds, the Discord webhook, and the exact AI prompts. Changes save immediately and apply on the next cron run."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {ordered.map((s) =>
          s.key === "bb_webhook_id" ? (
            <WebhookSelectField
              key={s.key}
              currentId={String(s.value ?? "")}
              label={s.label}
              description={s.description}
              webhooks={webhooks}
            />
          ) : (
            <SettingField key={s.key} setting={s} />
          ),
        )}
      </div>
    </BeaconBriefPageShell>
  );
}
