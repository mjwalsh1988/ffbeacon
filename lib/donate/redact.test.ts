import { describe, expect, it } from "vitest";
import { redactStripeEvent } from "./redact";

/**
 * The privacy boundary, tested the way the signature verifier is tested.
 *
 * The Privacy Policy and migration 0270 both promise that the stored donation
 * record holds no name, no email address, no billing address and nothing about
 * the card. These tests are that promise written down somewhere it can fail.
 */

/** A Checkout Session with every identity field Stripe can attach, populated. */
const HOSTILE_EVENT = {
  id: "evt_1",
  type: "checkout.session.completed",
  livemode: true,
  created: 1_700_000_000,
  data: {
    object: {
      id: "cs_test_abc",
      object: "checkout.session",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: 2500,
      currency: "usd",
      payment_intent: "pi_test_abc",
      livemode: true,
      created: 1_699_999_000,
      metadata: { product: "ffbeacon_donation", origin: "donate_page" },

      // Everything below here must not survive.
      customer: "cus_secret",
      customer_email: "donor@example.com",
      customer_details: {
        email: "donor@example.com",
        name: "Jane Donor",
        phone: "+15555550123",
        address: {
          line1: "12 Privacy Lane",
          city: "Indianapolis",
          postal_code: "46204",
          country: "US",
        },
        tax_ids: [{ type: "us_ein", value: "12-3456789" }],
      },
      collected_information: {
        shipping_details: {
          name: "Jane Donor",
          address: { line1: "12 Privacy Lane", postal_code: "46204" },
        },
      },
      shipping_details: {
        name: "Jane Donor",
        address: { line1: "12 Privacy Lane" },
      },
      custom_fields: [{ key: "note", text: { value: "Jane Donor, 12 Privacy Lane" } }],
      customer_creation: "if_required",
      client_reference_id: "donor@example.com",
      recovered_from: null,
    },
  },
};

/** Every string anywhere in the output, so nothing can hide in a nested value. */
function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe("redactStripeEvent", () => {
  it("keeps the facts a donation record is made of", () => {
    const out = redactStripeEvent(HOSTILE_EVENT) as Record<string, unknown>;
    const object = out.object as Record<string, unknown>;
    expect(out.id).toBe("evt_1");
    expect(out.type).toBe("checkout.session.completed");
    expect(out.livemode).toBe(true);
    expect(object.id).toBe("cs_test_abc");
    expect(object.amount_total).toBe(2500);
    expect(object.currency).toBe("usd");
    expect(object.payment_status).toBe("paid");
    expect(object.payment_intent).toBe("pi_test_abc");
    expect(object.metadata).toEqual({
      product: "ffbeacon_donation",
      origin: "donate_page",
    });
  });

  /**
   * The one that matters. Not "these three keys are gone" but "this person does
   * not appear anywhere in the output", which is the promise as a reader of the
   * Privacy Policy would understand it.
   */
  it("keeps no trace of the donor, anywhere in the output", () => {
    const text = serialized(redactStripeEvent(HOSTILE_EVENT));
    for (const secret of [
      "donor@example.com",
      "Jane Donor",
      "12 Privacy Lane",
      "Indianapolis",
      "46204",
      "+15555550123",
      "12-3456789",
      "cus_secret",
    ]) {
      expect(text, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it("drops the containers those details arrive in", () => {
    const object = (redactStripeEvent(HOSTILE_EVENT) as Record<string, unknown>)
      .object as Record<string, unknown>;
    for (const key of [
      "customer",
      "customer_email",
      "customer_details",
      "collected_information",
      "shipping_details",
      "custom_fields",
      "client_reference_id",
    ]) {
      expect(Object.keys(object), `kept ${key}`).not.toContain(key);
    }
  });

  /**
   * The reason this is an allow-list. A deny-list passes this test only if
   * somebody thought of the field in advance, and the whole failure mode is
   * that Stripe adds one nobody thought of.
   */
  it("drops a field Stripe has not shipped yet", () => {
    const out = redactStripeEvent({
      ...HOSTILE_EVENT,
      data: {
        object: {
          ...HOSTILE_EVENT.data.object,
          some_future_identity_field: { email: "donor@example.com" },
        },
      },
    });
    expect(serialized(out)).not.toContain("donor@example.com");
    expect(serialized(out)).not.toContain("some_future_identity_field");
  });

  it("flattens an expanded payment intent to its id", () => {
    const out = redactStripeEvent({
      ...HOSTILE_EVENT,
      data: {
        object: {
          ...HOSTILE_EVENT.data.object,
          payment_intent: {
            id: "pi_expanded",
            charges: {
              data: [{ billing_details: { email: "donor@example.com", name: "Jane Donor" } }],
            },
          },
        },
      },
    });
    const object = (out as Record<string, unknown>).object as Record<string, unknown>;
    expect(object.payment_intent).toBe("pi_expanded");
    expect(serialized(out)).not.toContain("donor@example.com");
  });

  it("does not trust metadata to be strings, or to be small", () => {
    const out = redactStripeEvent({
      ...HOSTILE_EVENT,
      data: {
        object: {
          ...HOSTILE_EVENT.data.object,
          metadata: {
            origin: "donate_page",
            nested: { email: "donor@example.com" },
            long: "x".repeat(5000),
          },
        },
      },
    });
    const meta = (
      (out as Record<string, unknown>).object as Record<string, unknown>
    ).metadata as Record<string, string>;
    expect(meta.origin).toBe("donate_page");
    expect(meta.nested).toBeUndefined();
    expect(meta.long.length).toBe(200);
    expect(serialized(out)).not.toContain("donor@example.com");
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, {}, { data: {} }, { data: { object: null } }, 42, "x"]) {
      expect(() => redactStripeEvent(junk)).not.toThrow();
    }
    const out = redactStripeEvent(null) as Record<string, unknown>;
    expect(out.id).toBeNull();
    expect(out.object).toEqual({});
  });
});
