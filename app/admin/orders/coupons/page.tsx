import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadAllCoupons } from "@/lib/commerce/coupons";
import { loadActiveProducts } from "@/lib/commerce/products";
import { CouponsManager } from "@/components/admin/coupons-manager";
import { OrdersSubnav } from "@/components/admin/orders-subnav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Coupons" };

export default async function CouponsPage() {
  await requireAdmin("/admin/orders/coupons");
  const admin = createAdminClient();
  const [coupons, products] = await Promise.all([loadAllCoupons(admin), loadActiveProducts(admin)]);
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Coupons</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        A code a customer types at checkout. A code that covers the whole price makes the review free and skips
        payment.
      </p>
      <OrdersSubnav />
      <CouponsManager coupons={coupons} products={products.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}
