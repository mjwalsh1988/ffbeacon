import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/commerce/constants";
import { lookupCustomers } from "@/lib/commerce/customers";
import {
  ADMIN_VIEWS,
  listOrdersForAdmin,
  loadAdminFigures,
  searchOrders,
  type AdminView,
} from "@/lib/commerce/orders";
import { Pager } from "@/components/admin/pager";
import { ViewTabs } from "@/components/admin/view-tabs";
import { OrdersSubnav } from "@/components/admin/orders-subnav";
import { OrderSearch } from "@/components/admin/order-search";
import { FigureTile } from "@/components/commerce/figure-tile";
import { OrderList } from "@/components/commerce/order-list";
import { RevenueBars } from "@/components/commerce/revenue-bars";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orders" };

const VIEW_LABELS: Record<AdminView, string> = {
  attention: "Needs attention",
  queue: "Queue",
  awaiting: "Awaiting payment",
  delivered: "Delivered",
  closed: "Canceled and refunded",
  all: "All",
};

const EMPTY: Record<AdminView, string> = {
  attention: "Nothing needs attention.",
  queue: "The queue is empty.",
  awaiting: "No order is waiting for a payment.",
  delivered: "Nothing delivered yet.",
  closed: "Nothing canceled or refunded.",
  all: "No orders yet.",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  await requireAdmin("/admin/orders");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const admin = createAdminClient();
  const now = new Date();
  const figures = await loadAdminFigures(admin, now);

  const requested = ADMIN_VIEWS.find((v) => v === sp.view);
  const view: AdminView = requested ?? (figures.attention > 0 ? "attention" : "queue");

  // A search ignores the tab: the reader is looking for one person or one order.
  const search = q ? await searchOrders(admin, q, page) : null;
  const list = search ?? (await listOrdersForAdmin(admin, view, page, now));
  const customers = await lookupCustomers(
    admin,
    list.rows.map((row) => row.user_id),
  );
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));

  const emptyMessage = search?.noCustomer
    ? `No customer has an email containing ${q}.`
    : search
      ? `No order matches ${q}.`
      : EMPTY[view];

  return (
    <div className="mx-auto max-w-7xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">Orders</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Orders</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">Every purchase, where it is, and what is due.</p>
      <OrdersSubnav />

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 border-t border-line pt-6 sm:grid-cols-3 lg:grid-cols-6">
        <FigureTile
          label="Needs attention"
          value={figures.attention}
          tone={figures.attention > 0 ? "danger" : "ink"}
          hint={figures.attentionHint}
        />
        <FigureTile label="In the queue" value={figures.queued} tone="purple" />
        <FigureTile label="In progress" value={figures.inProgress} tone="cyan" />
        <FigureTile label="Awaiting payment" value={figures.awaiting} tone="warning" />
        <FigureTile
          label="Revenue, 30 days"
          value={formatMoney(figures.revenue30Cents)}
          compact
          className="col-span-2 sm:col-span-1"
        >
          <RevenueBars weeks={figures.weeks} />
        </FigureTile>
        <FigureTile
          label="Turnaround, 30 days"
          value={figures.turnaroundDays == null ? "No deliveries yet" : figures.turnaroundDays.toFixed(1)}
          srSuffix={figures.turnaroundDays == null ? undefined : "days"}
          compact
          className="col-span-2 sm:col-span-1"
        />
      </dl>

      <div className="mt-8">
        <OrderSearch query={q} />
      </div>

      {!search && (
        <div className="mt-6">
          <ViewTabs
            label="Order views"
            current={view}
            tabs={ADMIN_VIEWS.map((key) => ({
              key,
              label: VIEW_LABELS[key],
              href: `/admin/orders?view=${key}`,
            }))}
          />
        </div>
      )}

      <div className="mt-4">
        {search && (
          <p role="status" className="mb-3 text-sm text-ink-muted">
            {list.total} {list.total === 1 ? "order" : "orders"} for {q}
          </p>
        )}
        {list.rows.length === 0 ? (
          <p className="py-6 text-sm text-ink-muted">{emptyMessage}</p>
        ) : (
          <OrderList variant="admin" rows={list.rows} customers={customers} now={now} />
        )}
        <Pager
          basePath="/admin/orders"
          paramName="page"
          currentPage={page}
          totalPages={totalPages}
          label="Orders pages"
          extraParams={q ? { q } : { view }}
        />
      </div>
    </div>
  );
}
