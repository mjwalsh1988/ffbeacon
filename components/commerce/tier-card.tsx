/**
 * A review as a card: the one place in the store a box earns its border, because a
 * choice between peers is what a card is for.
 *
 * Two forms. `TierChoiceCard` is a native radio in a label, for the checkout, with
 * the name as text rather than a heading, because the fieldset legend is the
 * heading. `TierOfferCard` is the same card with a link at its foot, for the offers.
 * `TierCardStatic` has neither, for a reader who cannot order.
 *
 * The price is real text on two spans, neither of them aria-hidden.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Check } from "lucide-react";
import { StatusChip } from "./status-chip";

export type TierCardProduct = {
  slug: string;
  name: string;
  badge: string | null;
  tagline: string | null;
  features: string[];
  price_cents: number;
  turnaround_days: number;
};

export function PriceBlock({ cents }: { cents: number }) {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return (
    <p className="font-mono font-black leading-none tabular-nums text-ink">
      <span className="text-5xl">${dollars.toLocaleString("en-US")}</span>
      <span className="align-top text-2xl">.{rest}</span>
      <span className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        one time
      </span>
    </p>
  );
}

function CardBody({ product }: { product: TierCardProduct }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-lg font-bold tracking-tight text-ink">{product.name}</p>
        {product.badge && <StatusChip chip={{ word: product.badge, tone: "purple" }} />}
      </div>
      <div className="mt-4">
        <PriceBlock cents={product.price_cents} />
      </div>
      {product.tagline && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{product.tagline}</p>}
      <p className="mt-3 text-sm font-medium text-brand-cyan">
        Delivered within {product.turnaround_days} {product.turnaround_days === 1 ? "day" : "days"} of payment
      </p>
      <ul role="list" className="mt-4 space-y-2">
        {product.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm leading-snug text-ink-muted">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-positive" />
            <span className="min-w-0">{feature}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const SHELL = "block rounded-card border bg-surface/60 p-5";

export function TierChoiceCard({
  product,
  name,
  checked,
  onChange,
}: {
  product: TierCardProduct;
  name: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`${SHELL} group cursor-pointer border-line transition-colors hover:border-line-accent has-[:checked]:border-brand-cyan has-[:checked]:ring-1 has-[:checked]:ring-brand-cyan has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan`}
    >
      <input
        type="radio"
        name={name}
        value={product.slug}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <CardBody product={product} />
      {/* The border color is not the only sign of the choice: a word appears with it. */}
      <span className="mt-4 hidden items-center gap-1.5 text-xs font-bold text-brand-cyan group-has-[:checked]:inline-flex">
        <Check aria-hidden="true" className="h-4 w-4" />
        Selected
      </span>
    </label>
  );
}

export function TierCardStatic({
  product,
  footer,
}: {
  product: TierCardProduct;
  footer?: ReactNode;
}) {
  return (
    <div className={`${SHELL} flex flex-col border-line`}>
      <CardBody product={product} />
      {footer && <div className="mt-auto pt-5">{footer}</div>}
    </div>
  );
}

export function TierOfferCard({ product, href }: { product: TierCardProduct; href: string }) {
  return (
    <TierCardStatic
      product={product}
      footer={
        <Link
          href={href as Route}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Order the {product.name}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      }
    />
  );
}
