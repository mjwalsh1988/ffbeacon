"use client";

/**
 * Every coupon as a ruled row, with an inline editor. A coupon is deactivated
 * rather than deleted, because orders reference it. The window inputs read and
 * write Eastern time.
 */

import { useId, useState } from "react";
import { createCouponAction, saveCouponAction } from "@/app/admin/orders/actions";
import { formatEasternDate } from "@/lib/datetime";
import { formatMoney } from "@/lib/commerce/constants";
import { easternLocalToIso, isoToEasternLocal } from "@/lib/commerce/eastern-input";
import type { Coupon, Product } from "@/lib/commerce/types";
import { RULED } from "@/components/league-blueprint/sheet";
import { StatusChip } from "@/components/commerce/status-chip";
import { ActionStatus, ADMIN_BUTTON, ADMIN_FIELD, ADMIN_LABEL, ADMIN_PRIMARY, useOrderAction } from "./order-action";

export type CouponRow = Coupon & { redemptions: number };
type ProductChoice = Pick<Product, "id" | "name">;

function discountWords(coupon: Coupon): string {
  if (coupon.kind === "percent") {
    return coupon.percent_off === 100 ? "100% off (free)" : `${coupon.percent_off}% off`;
  }
  return `${formatMoney(coupon.amount_off_cents ?? 0)} off`;
}

function scopeWords(coupon: Coupon, products: ProductChoice[]): string {
  if (coupon.product_id) return products.find((p) => p.id === coupon.product_id)?.name ?? "One product";
  if (coupon.product_family) return `${coupon.product_family} family`;
  return "Any review";
}

function windowWords(coupon: Coupon): string {
  if (!coupon.starts_at && !coupon.expires_at) return "No window";
  const from = coupon.starts_at ? formatEasternDate(coupon.starts_at) : "Now";
  const to = coupon.expires_at ? formatEasternDate(coupon.expires_at) : "no end";
  return `${from} to ${to}`;
}

function CopyCode({ code }: { code: string }) {
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        type="button"
        aria-label={`Copy code ${code}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setMessage(`${code} copied to clipboard.`);
          } catch {
            setMessage("Clipboard unavailable.");
          }
        }}
        className={ADMIN_BUTTON}
      >
        Copy code
      </button>
      <span role="status" className="sr-only">
        {message}
      </span>
    </>
  );
}

function CouponForm({
  coupon,
  products,
  onDone,
}: {
  coupon: Coupon | null;
  products: ProductChoice[];
  onDone: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [kind, setKind] = useState<"percent" | "amount">(coupon?.kind ?? "percent");
  const [percent, setPercent] = useState(String(coupon?.percent_off ?? ""));
  const [amount, setAmount] = useState(coupon?.amount_off_cents ? (coupon.amount_off_cents / 100).toFixed(2) : "");
  const [family, setFamily] = useState(coupon?.product_family ?? "");
  const [productId, setProductId] = useState(coupon?.product_id ?? "");
  const [maxTotal, setMaxTotal] = useState(coupon?.max_redemptions != null ? String(coupon.max_redemptions) : "");
  const [maxUser, setMaxUser] = useState(String(coupon?.max_redemptions_per_user ?? 1));
  const [startsAt, setStartsAt] = useState(isoToEasternLocal(coupon?.starts_at));
  const [expiresAt, setExpiresAt] = useState(isoToEasternLocal(coupon?.expires_at));
  const [active, setActive] = useState(coupon?.is_active ?? true);
  const [note, setNote] = useState(coupon?.note ?? "");
  const { run, pending, status, failed } = useOrderAction();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      id: coupon?.id ?? null,
      code,
      kind,
      percentOff: kind === "percent" ? Number(percent) || null : null,
      amountOffCents: kind === "amount" ? Math.round(Number(amount) * 100) || null : null,
      productFamily: family.trim() || null,
      productId: productId || null,
      maxRedemptions: maxTotal.trim() ? Number(maxTotal) : null,
      maxRedemptionsPerUser: Number(maxUser),
      startsAt: startsAt ? easternLocalToIso(startsAt) : null,
      expiresAt: expiresAt ? easternLocalToIso(expiresAt) : null,
      isActive: active,
      note: note.trim() || null,
    };
    run(() => (coupon ? saveCouponAction(payload) : createCouponAction(payload)), onDone);
  };

  return (
    <form onSubmit={submit} className="space-y-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={`${id}-code`} className={ADMIN_LABEL}>
            Code
          </label>
          <input
            id={`${id}-code`}
            type="text"
            maxLength={24}
            readOnly={Boolean(coupon)}
            autoCapitalize="characters"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11 font-mono uppercase ${coupon ? "opacity-70" : ""}`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className={ADMIN_LABEL}>
            Kind
          </label>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as "percent" | "amount")}
            className={`${ADMIN_FIELD} min-h-11`}
          >
            <option value="percent">Percent off</option>
            <option value="amount">Amount off</option>
          </select>
        </div>
        {kind === "percent" ? (
          <div>
            <label htmlFor={`${id}-percent`} className={ADMIN_LABEL}>
              Percent off, 1 to 100
            </label>
            <input
              id={`${id}-percent`}
              type="number"
              inputMode="numeric"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              className={`${ADMIN_FIELD} min-h-11`}
            />
          </div>
        ) : (
          <div>
            <label htmlFor={`${id}-amount`} className={ADMIN_LABEL}>
              Dollars off
            </label>
            <input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={`${ADMIN_FIELD} min-h-11 font-mono`}
            />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-family`} className={ADMIN_LABEL}>
            Product family, optional
          </label>
          <input
            id={`${id}-family`}
            type="text"
            value={family}
            onChange={(event) => setFamily(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-product`} className={ADMIN_LABEL}>
            Product, optional
          </label>
          <select
            id={`${id}-product`}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11`}
          >
            <option value="">Any product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-max`} className={ADMIN_LABEL}>
            Max redemptions, optional
          </label>
          <input
            id={`${id}-max`}
            type="number"
            inputMode="numeric"
            value={maxTotal}
            onChange={(event) => setMaxTotal(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-peruser`} className={ADMIN_LABEL}>
            Max per customer
          </label>
          <input
            id={`${id}-peruser`}
            type="number"
            inputMode="numeric"
            value={maxUser}
            onChange={(event) => setMaxUser(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-starts`} className={ADMIN_LABEL}>
            Starts at, Eastern, optional
          </label>
          <input
            id={`${id}-starts`}
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-expires`} className={ADMIN_LABEL}>
            Expires at, Eastern, optional
          </label>
          <input
            id={`${id}-expires`}
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className={`${ADMIN_FIELD} min-h-11`}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-note`} className={ADMIN_LABEL}>
          Note, admin only
        </label>
        <textarea
          id={`${id}-note`}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-brand-cyan"
        />
        Active
      </label>
      <button type="submit" disabled={pending} className={`${ADMIN_PRIMARY} w-full sm:w-auto`}>
        {pending ? "Saving..." : coupon ? "Save" : "Add coupon"}
      </button>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}

export function CouponsManager({
  coupons,
  products,
}: {
  coupons: CouponRow[];
  products: ProductChoice[];
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="mt-6">
      {coupons.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">No coupons yet.</p>
      ) : (
        <ul role="list" className={RULED}>
          {coupons.map((coupon) => (
            <li key={coupon.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm font-bold text-ink">{coupon.code}</span>
                <StatusChip
                  chip={
                    coupon.is_active
                      ? { word: "Active", tone: "positive" }
                      : { word: "Inactive", tone: "muted" }
                  }
                />
                <span className="text-sm text-ink">{discountWords(coupon)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {scopeWords(coupon, products)}.{" "}
                {coupon.max_redemptions != null
                  ? `${coupon.redemptions} of ${coupon.max_redemptions}`
                  : `${coupon.redemptions}, no cap`}
                . {windowWords(coupon)}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyCode code={coupon.code} />
              </div>
              <details className="mt-1">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
                  Edit {coupon.code}
                </summary>
                <CouponForm coupon={coupon} products={products} onDone={() => undefined} />
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        {adding ? (
          <>
            <h2 className="text-sm font-bold text-ink">Add coupon</h2>
            <CouponForm coupon={null} products={products} onDone={() => setAdding(false)} />
          </>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={ADMIN_BUTTON}>
            Add coupon
          </button>
        )}
      </div>
    </div>
  );
}
