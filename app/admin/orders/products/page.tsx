import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadAllProducts } from "@/lib/commerce/products";
import { OrdersSubnav } from "@/components/admin/orders-subnav";
import { ProductsManager } from "@/components/admin/products-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  await requireAdmin("/admin/orders/products");
  const products = await loadAllProducts(createAdminClient());
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Products</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Changing a price changes new orders only. Every past order keeps the price it was sold at.
      </p>
      <OrdersSubnav />
      <ProductsManager products={products} />
    </div>
  );
}
