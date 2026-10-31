import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/commerce/constants";
import { listOrdersForOwner, loadOwnerFigures } from "@/lib/commerce/orders";
import { Panel } from "@/components/dashboard-panel";
import { Pager } from "@/components/admin/pager";
import { FigureTile } from "@/components/commerce/figure-tile";
import { OrderList } from "@/components/commerce/order-list";

export const metadata: Metadata = {
  title: "Orders",
  description: "Every review you have bought, its receipt, and where it is right now.",
  robots: { index: false, follow: false },
};

/** Reads go through the session client, so RLS scopes them to this reader. */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const supabase = await createClient();
  const [list, figures] = await Promise.all([listOrdersForOwner(supabase, page), loadOwnerFigures(supabase)]);
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <Panel eyebrow="Yours" title="Orders" helper="Every review you have bought, and where it is.">
      {list.total === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          No orders yet. A Personal Team Review starts from any team&apos;s Blueprint in League Pulse.{" "}
          <Link
            href="/tools/league-pulse"
            className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Open League Pulse
          </Link>
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
            <FigureTile label="Open" value={figures.open} tone="cyan" srSuffix={figures.open === 1 ? "order" : "orders"} />
            <FigureTile label="Delivered" value={figures.delivered} tone="positive" />
            <FigureTile
              label="Spent"
              value={formatMoney(figures.spentCents)}
              compact
              className="col-span-2 sm:col-span-1"
            />
          </dl>
          <div className="mt-6">
            <OrderList variant="customer" rows={list.rows} />
          </div>
          <Pager
            basePath="/my-beacon/orders"
            paramName="page"
            currentPage={page}
            totalPages={totalPages}
            label="Orders pages"
          />
        </>
      )}
    </Panel>
  );
}
