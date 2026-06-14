import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { SourcesManager, type ManagedSource } from "@/components/admin/sources-manager";
import { FormatNamesEditor, type FormatNameRow } from "@/components/admin/format-names-editor";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

export default async function BeaconSourcesPage() {
  await requireAdmin("/admin/beacon/sources");
  const admin = createAdminClient();
  const [{ data: sources }, { data: formats }, recompute] = await Promise.all([
    admin
      .from("source_registry")
      .select("slug, display_name, is_active, is_default, priority")
      .order("priority"),
    admin
      .from("format_configs")
      .select("id, slug, display_name, display_order")
      .eq("is_active", true)
      .order("display_order"),
    getRecomputeStatus(admin, Date.now()),
  ]);

  return (
    <BeaconPageShell
      title="Sources"
      description="Manage value sources and format labels. Activation and ordering apply to the public source picker; the default source backs anonymous visitors and logged-in users with no saved preference."
      recompute={recompute}
    >
      <div className="space-y-12">
        <section aria-labelledby="sources-h">
          <h2 id="sources-h" className="text-lg font-semibold tracking-tight text-ink">
            Value sources
          </h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm text-ink-muted">
            Toggle a source active or inactive (inactive drops cleanly from the blend on the next recompute). Promote exactly one source to the site-wide default, and reorder how sources appear in the public picker. The default cannot be deactivated; promote a new default first.
          </p>
          <SourcesManager sources={(sources ?? []) as ManagedSource[]} />
        </section>

        <section aria-labelledby="format-names-h">
          <h2 id="format-names-h" className="text-lg font-semibold tracking-tight text-ink">
            Format display names
          </h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm text-ink-muted">
            Control how each format reads across the site. The slug below each field is an internal reference and is never shown to users; the display name you set here is what renders.
          </p>
          <FormatNamesEditor formats={(formats ?? []) as FormatNameRow[]} />
        </section>
      </div>
    </BeaconPageShell>
  );
}
