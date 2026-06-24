import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  SourcesManager,
  type SourceView,
} from "@/components/admin/beacon-brief/sources-manager";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

export default async function BeaconBriefSourcesPage() {
  await requireAdmin("/admin/beacon-brief/sources");
  const admin = createAdminClient();
  const { data } = await admin
    .from("news_sources")
    .select(
      "id, admin_label, source_type, handle, is_active, last_poll_status, last_polled_at, last_poll_error",
    )
    .order("created_at", { ascending: true });

  const sources: SourceView[] = (data ?? []) as SourceView[];

  return (
    <BeaconBriefPageShell
      title="Sources"
      description="The accounts the curation cron monitors. Add an X handle, toggle it on or off, and see whether the most recent poll for each source succeeded or failed."
    >
      <SourcesManager sources={sources} />
    </BeaconBriefPageShell>
  );
}
