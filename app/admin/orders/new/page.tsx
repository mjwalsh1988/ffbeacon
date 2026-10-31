import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadActiveProducts } from "@/lib/commerce/products";
import { NewOrderForm } from "@/components/admin/new-order-form";
import { OrdersSubnav } from "@/components/admin/orders-subnav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Create an order" };

export default async function NewOrderPage() {
  await requireAdmin("/admin/orders/new");
  const products = await loadActiveProducts(createAdminClient());
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create an order for a customer</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        A complimentary order: no payment, paid and queued the moment you create it. The customer gets an email and
        can add their questions from the order page.
      </p>
      <OrdersSubnav />
      <NewOrderForm
        products={products.map((p) => ({
          slug: p.slug,
          name: p.name,
          family: p.family,
          price_cents: p.price_cents,
        }))}
      />
    </div>
  );
}
