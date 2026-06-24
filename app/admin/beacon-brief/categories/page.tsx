import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  CategoriesManager,
  type CategoryView,
} from "@/components/admin/beacon-brief/categories-manager";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

export default async function BeaconBriefCategoriesPage() {
  await requireAdmin("/admin/beacon-brief/categories");
  const admin = createAdminClient();
  const { data } = await admin
    .from("news_categories")
    .select(
      "id, name, slug, description, discord_role_ids, display_order, is_active",
    )
    .order("display_order", { ascending: true });

  const categories: CategoryView[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    discord_role_ids: c.discord_role_ids ?? [],
    display_order: c.display_order,
    is_active: c.is_active,
  }));

  return (
    <BeaconBriefPageShell
      title="Categories"
      description="The category set the AI must choose from when scoring a post. Each category can ping one or more Discord roles, so the right groups get notified when a post lands in it."
    >
      <CategoriesManager categories={categories} />
    </BeaconBriefPageShell>
  );
}
