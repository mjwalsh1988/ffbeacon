import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadCommerceSettings } from "@/lib/commerce/settings";
import { CommerceSettingsManager } from "@/components/admin/commerce-settings-manager";
import { OrdersSubnav } from "@/components/admin/orders-subnav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Store settings" };

export default async function OrderSettingsPage() {
  await requireAdmin("/admin/orders/settings");
  const settings = await loadCommerceSettings(createAdminClient());
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Store settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Whether reviews are on sale, how they are paid for, and who hears about what. A save lands within a minute.
      </p>
      <OrdersSubnav />
      <CommerceSettingsManager initialSettings={settings} />
    </div>
  );
}
