"use client";

/**
 * Every product, each an expandable editor. A product is deactivated rather than
 * deleted, because orders reference it.
 */

import { useId, useState } from "react";
import { createProductAction, saveProductAction } from "@/app/admin/orders/actions";
import { formatMoney } from "@/lib/commerce/constants";
import { featuresFromLines, linesFromFeatures, PRODUCT_PLACEMENTS } from "@/lib/commerce/product-fields";
import type { Product, ProductPlacement } from "@/lib/commerce/types";
import { RULED } from "@/components/league-blueprint/sheet";
import { StatusChip } from "@/components/commerce/status-chip";
import { ActionStatus, ADMIN_BUTTON, ADMIN_FIELD, ADMIN_LABEL, ADMIN_PRIMARY, useOrderAction } from "./order-action";

const PLACEMENT_LABEL: Record<ProductPlacement, string> = {
  blueprint: "Blueprint section",
  "league-overview": "League overview strip",
  "my-beacon": "My Beacon tile",
};

type Draft = {
  slug: string;
  family: string;
  tierRank: number;
  name: string;
  tagline: string;
  description: string;
  badge: string;
  featuresText: string;
  priceText: string;
  turnaroundDays: number;
  placements: ProductPlacement[];
  isActive: boolean;
  displayOrder: number;
};

function draftFrom(product: Product | null): Draft {
  return {
    slug: product?.slug ?? "",
    family: product?.family ?? "team-review",
    tierRank: product?.tier_rank ?? 1,
    name: product?.name ?? "",
    tagline: product?.tagline ?? "",
    description: product?.description ?? "",
    badge: product?.badge ?? "",
    featuresText: linesFromFeatures(product?.features ?? []),
    priceText: product ? (product.price_cents / 100).toFixed(2) : "",
    turnaroundDays: product?.turnaround_days ?? 3,
    placements: product?.placements ?? [],
    isActive: product?.is_active ?? true,
    displayOrder: product?.display_order ?? 100,
  };
}

function ProductForm({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const id = useId();
  const [d, setD] = useState<Draft>(() => draftFrom(product));
  const { run, pending, status, failed } = useOrderAction();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = { ...d, features: featuresFromLines(d.featuresText) };
    run(() => (product ? saveProductAction(payload) : createProductAction(payload)), onDone);
  };

  const text = (key: "name" | "tagline" | "badge" | "family" | "slug", label: string, max: number, readOnly = false) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={ADMIN_LABEL}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        type="text"
        maxLength={max}
        readOnly={readOnly}
        value={d[key]}
        onChange={(event) => set(key, event.target.value)}
        className={`${ADMIN_FIELD} min-h-11 ${readOnly ? "opacity-70" : ""}`}
      />
    </div>
  );

  const number = (key: "tierRank" | "turnaroundDays" | "displayOrder", label: string) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={ADMIN_LABEL}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        type="number"
        inputMode="numeric"
        value={d[key]}
        onChange={(event) => set(key, Number(event.target.value))}
        className={`${ADMIN_FIELD} min-h-11`}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {text("slug", "Slug", 60, Boolean(product))}
        {text("family", "Family", 60)}
        {number("tierRank", "Tier rank")}
        {text("name", "Name", 60)}
        {text("badge", "Badge", 24)}
        <div>
          <label htmlFor={`${id}-price`} className={ADMIN_LABEL}>
            Price in dollars
          </label>
          <input
            id={`${id}-price`}
            type="text"
            inputMode="decimal"
            value={d.priceText}
            onChange={(event) => set("priceText", event.target.value)}
            className={`${ADMIN_FIELD} min-h-11 font-mono`}
          />
        </div>
        {number("turnaroundDays", "Turnaround days")}
        {number("displayOrder", "Display order")}
      </div>
      {text("tagline", "Tagline", 140)}
      <div>
        <label htmlFor={`${id}-description`} className={ADMIN_LABEL}>
          Description
        </label>
        <textarea
          id={`${id}-description`}
          rows={3}
          maxLength={2000}
          value={d.description}
          onChange={(event) => set("description", event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <div>
        <label htmlFor={`${id}-features`} className={ADMIN_LABEL}>
          Features, one per line, at most 12
        </label>
        <textarea
          id={`${id}-features`}
          rows={6}
          value={d.featuresText}
          onChange={(event) => set("featuresText", event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <fieldset className="min-w-0">
        <legend className={ADMIN_LABEL}>Placements</legend>
        <div className="mt-1 grid gap-x-4 sm:grid-cols-3">
          {PRODUCT_PLACEMENTS.map((placement) => (
            <label key={placement} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={d.placements.includes(placement)}
                onChange={(event) =>
                  set(
                    "placements",
                    event.target.checked
                      ? [...d.placements, placement]
                      : d.placements.filter((p) => p !== placement),
                  )
                }
                className="h-5 w-5 shrink-0 accent-brand-cyan"
              />
              {PLACEMENT_LABEL[placement]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={d.isActive}
          onChange={(event) => set("isActive", event.target.checked)}
          className="h-5 w-5 shrink-0 accent-brand-cyan"
        />
        Active
      </label>
      <button type="submit" disabled={pending} className={`${ADMIN_PRIMARY} w-full sm:w-auto`}>
        {pending ? "Saving..." : product ? "Save" : "Add product"}
      </button>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}

export function ProductsManager({ products }: { products: Product[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="mt-6">
      <ul role="list" className={RULED}>
        {products.map((product) => (
          <li key={product.id}>
            <details>
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{product.name}</span>
                  <span className="block break-all font-mono text-[11px] text-ink-muted">{product.slug}</span>
                </span>
                <span className="font-mono text-sm font-bold tabular-nums text-ink">
                  {formatMoney(product.price_cents)}
                </span>
                <StatusChip
                  chip={
                    product.is_active
                      ? { word: "Active", tone: "positive" }
                      : { word: "Inactive", tone: "muted" }
                  }
                />
              </summary>
              <ProductForm product={product} onDone={() => undefined} />
            </details>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {adding ? (
          <>
            <h2 className="text-sm font-bold text-ink">Add product</h2>
            <ProductForm product={null} onDone={() => setAdding(false)} />
          </>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={ADMIN_BUTTON}>
            Add product
          </button>
        )}
      </div>
    </div>
  );
}
