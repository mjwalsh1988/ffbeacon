/**
 * Code defaults for the Beacon Store settings. Used until the first save from
 * /admin/orders/settings creates the commerce_settings row, and to fill a row
 * written before a field existed.
 *
 * `stripeUnpaidExpiryHours` applies only to an unpaid Stripe order that has NO
 * session (the create call failed). An order with a session expires 5 minutes
 * after Stripe's own expires_at. The duplicate, mismatch and chargeback
 * notifications have no switch: they are always sent.
 */

export const DEFAULT_COMMERCE_SETTINGS = {
  version: 1,
  storefront: {
    enabled: true,
    fullyBooked: false,
    maxOpenOrders: 10,
    countPendingPayment: true,
    fullyBookedMessage: "Michael is fully booked right now. Check back in a few days.",
  },
  payments: {
    stripe: true,
    paypal: true,
    venmo: true,
    manualExpiryDays: 7,
    manualReminderDay: 3,
    stripeSessionMinutes: 60,
    stripeUnpaidExpiryHours: 25,
  },
  coupons: { enabled: true },
  notifications: {
    adminEmail: "michael@ffbeacon.com",
    notifyOnNew: false,
    notifyOnPaid: true,
    notifyOnReported: true,
  },
  emails: { receiptRetryMax: 3, receiptRetryAfterMinutes: 10 },
  rateLimits: {
    checkoutPerMinute: 6,
    reconcilePerMinute: 10,
    reportPaymentPerMinute: 6,
    couponPreviewPerMinute: 20,
  },
  placements: { blueprintSection: true, overviewStrip: true, myBeaconTile: true },
};

export type CommerceSettings = typeof DEFAULT_COMMERCE_SETTINGS;
