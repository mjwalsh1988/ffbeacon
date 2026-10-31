"use client";

/**
 * The storefront's switches and limits, grouped as plan section 14 groups them.
 * Saving validates on the server. A storefront render reads these through a
 * 60-second memo, so a save lands within a minute on every instance.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCommerceSettingsAction } from "@/app/admin/orders/actions";
import { DEFAULT_COMMERCE_SETTINGS, type CommerceSettings } from "@/lib/commerce/default-settings";
import {
  CheckboxField,
  NumberField,
  SettingsSaveBar,
  SettingsSection,
  settingsInputCls,
} from "./settings-form-kit";

export function CommerceSettingsManager({ initialSettings }: { initialSettings: CommerceSettings }) {
  const router = useRouter();
  const [s, setS] = useState<CommerceSettings>(initialSettings);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  const patch = <K extends keyof CommerceSettings>(group: K, value: Partial<CommerceSettings[K]>) =>
    setS((prev) => ({
      ...prev,
      [group]: { ...(prev[group] as object), ...(value as object) },
    }));

  const save = () => {
    setStatus("");
    startTransition(async () => {
      const result = await saveCommerceSettingsAction(s);
      setStatus(result.ok ? "Saved. It lands everywhere within a minute." : result.error);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="mt-6 space-y-4">
      <SettingsSection title="Storefront" description="Whether reviews are on sale, and the door a one-person service needs.">
        <CheckboxField
          label="Enabled"
          checked={s.storefront.enabled}
          onChange={(enabled) => patch("storefront", { enabled })}
        />
        <CheckboxField
          label="Fully booked"
          checked={s.storefront.fullyBooked}
          onChange={(fullyBooked) => patch("storefront", { fullyBooked })}
          hint="Closes every offer whatever the count."
        />
        <NumberField
          label="Max open orders"
          value={s.storefront.maxOpenOrders}
          min={1}
          max={500}
          onChange={(maxOpenOrders) => patch("storefront", { maxOpenOrders })}
        />
        <CheckboxField
          label="Count pending payment"
          checked={s.storefront.countPendingPayment}
          onChange={(countPendingPayment) => patch("storefront", { countPendingPayment })}
          hint="A Stripe payment cannot be refused later, so unpaid orders hold a place."
        />
        <div className="sm:col-span-2">
          <label htmlFor="fully-booked-message" className="block text-xs font-medium text-ink-subtle">
            Fully booked message
          </label>
          <input
            id="fully-booked-message"
            type="text"
            maxLength={200}
            value={s.storefront.fullyBookedMessage}
            onChange={(event) => patch("storefront", { fullyBookedMessage: event.target.value })}
            className={settingsInputCls}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Payments" description="Which methods are offered, and how long an unpaid order stays open.">
        <CheckboxField label="Stripe" checked={s.payments.stripe} onChange={(stripe) => patch("payments", { stripe })} />
        <CheckboxField label="PayPal" checked={s.payments.paypal} onChange={(paypal) => patch("payments", { paypal })} />
        <CheckboxField label="Venmo" checked={s.payments.venmo} onChange={(venmo) => patch("payments", { venmo })} />
        <NumberField
          label="Manual expiry, days"
          value={s.payments.manualExpiryDays}
          min={1}
          max={30}
          onChange={(manualExpiryDays) => patch("payments", { manualExpiryDays })}
        />
        <NumberField
          label="Manual reminder, day"
          value={s.payments.manualReminderDay}
          min={1}
          max={29}
          onChange={(manualReminderDay) => patch("payments", { manualReminderDay })}
          hint="Must come before the expiry."
        />
        <NumberField
          label="Stripe session, minutes"
          value={s.payments.stripeSessionMinutes}
          min={30}
          max={1440}
          onChange={(stripeSessionMinutes) => patch("payments", { stripeSessionMinutes })}
          hint="Stripe accepts 30 minutes to 24 hours."
        />
        <NumberField
          label="Stripe unpaid expiry, hours"
          value={s.payments.stripeUnpaidExpiryHours}
          min={1}
          max={72}
          onChange={(stripeUnpaidExpiryHours) => patch("payments", { stripeUnpaidExpiryHours })}
          hint="Only for an order whose session could not be created."
        />
      </SettingsSection>

      <SettingsSection title="Coupons" description="Whether the checkout offers a code field.">
        <CheckboxField label="Enabled" checked={s.coupons.enabled} onChange={(enabled) => patch("coupons", { enabled })} />
      </SettingsSection>

      <SettingsSection title="Notifications" description="Duplicate, mismatch and chargeback notices are always sent.">
        <div className="sm:col-span-2">
          <label htmlFor="admin-email" className="block text-xs font-medium text-ink-subtle">
            Admin email
          </label>
          <input
            id="admin-email"
            type="email"
            value={s.notifications.adminEmail}
            onChange={(event) => patch("notifications", { adminEmail: event.target.value })}
            className={settingsInputCls}
          />
        </div>
        <CheckboxField
          label="Notify on new manual order"
          checked={s.notifications.notifyOnNew}
          onChange={(notifyOnNew) => patch("notifications", { notifyOnNew })}
        />
        <CheckboxField
          label="Notify on paid"
          checked={s.notifications.notifyOnPaid}
          onChange={(notifyOnPaid) => patch("notifications", { notifyOnPaid })}
        />
        <CheckboxField
          label="Notify on reported payment"
          checked={s.notifications.notifyOnReported}
          onChange={(notifyOnReported) => patch("notifications", { notifyOnReported })}
        />
      </SettingsSection>

      <SettingsSection title="Emails" description="The receipt is retried by the hourly cron.">
        <NumberField
          label="Receipt retry max"
          value={s.emails.receiptRetryMax}
          min={0}
          max={10}
          onChange={(receiptRetryMax) => patch("emails", { receiptRetryMax })}
        />
        <NumberField
          label="Receipt retry after, minutes"
          value={s.emails.receiptRetryAfterMinutes}
          min={1}
          max={1440}
          onChange={(receiptRetryAfterMinutes) => patch("emails", { receiptRetryAfterMinutes })}
        />
      </SettingsSection>

      <SettingsSection title="Rate limits" description="Per person, per minute. All fail closed.">
        <NumberField
          label="Checkout"
          value={s.rateLimits.checkoutPerMinute}
          min={1}
          max={120}
          onChange={(checkoutPerMinute) => patch("rateLimits", { checkoutPerMinute })}
        />
        <NumberField
          label="Reconcile"
          value={s.rateLimits.reconcilePerMinute}
          min={1}
          max={120}
          onChange={(reconcilePerMinute) => patch("rateLimits", { reconcilePerMinute })}
        />
        <NumberField
          label="Report a payment"
          value={s.rateLimits.reportPaymentPerMinute}
          min={1}
          max={120}
          onChange={(reportPaymentPerMinute) => patch("rateLimits", { reportPaymentPerMinute })}
        />
        <NumberField
          label="Coupon preview"
          value={s.rateLimits.couponPreviewPerMinute}
          min={1}
          max={120}
          onChange={(couponPreviewPerMinute) => patch("rateLimits", { couponPreviewPerMinute })}
        />
      </SettingsSection>

      <SettingsSection title="Placements" description="Where the review is offered.">
        <CheckboxField
          label="Blueprint section"
          checked={s.placements.blueprintSection}
          onChange={(blueprintSection) => patch("placements", { blueprintSection })}
        />
        <CheckboxField
          label="League overview strip"
          checked={s.placements.overviewStrip}
          onChange={(overviewStrip) => patch("placements", { overviewStrip })}
        />
        <CheckboxField
          label="My Beacon tile"
          checked={s.placements.myBeaconTile}
          onChange={(myBeaconTile) => patch("placements", { myBeaconTile })}
        />
      </SettingsSection>

      <SettingsSaveBar
        onSave={save}
        onReset={() => setS(DEFAULT_COMMERCE_SETTINGS)}
        pending={pending}
        status={status}
        saveLabel="Save settings"
      />
    </div>
  );
}
