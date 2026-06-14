import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { ValueBandsEditor } from "@/components/admin/value-bands-editor";

export const metadata: Metadata = { title: "Value bands" };
export const dynamic = "force-dynamic";

export default async function BeaconBandsPage() {
  await requireAdmin("/admin/beacon/bands");
  const admin = createAdminClient();

  const { data: ffRow } = await admin
    .from("source_registry").select("supported_format_slugs").eq("slug", "ffbeacon").single();
  const ffSlugs = ffRow?.supported_format_slugs ?? [];

  const [{ data: bands }, { data: fmtRows }, recompute] = await Promise.all([
    admin.from("beacon_value_bands").select("id, position, format_config_id, floor, ceiling").order("position"),
    admin.from("format_configs").select("id, slug, display_order").order("display_order"),
    getRecomputeStatus(admin, Date.now()),
  ]);
  const formats = (fmtRows ?? []).filter((f) => ffSlugs.includes(f.slug)).map((f) => ({ id: f.id, slug: f.slug }));

  return (
    <BeaconPageShell
      title="Value bands"
      description="The value range each position can occupy. Resolution: per-format override, then global default. Skill is 0-10000; K/DEF are lower, and compressed further in dynasty."
      recompute={recompute}
    >
      <ValueBandsEditor bands={(bands ?? []) as never} formats={formats} />
    </BeaconPageShell>
  );
}
