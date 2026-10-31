import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reply-To on a customer email is michael@ffbeacon.com, and that is the DEFAULT in
 * lib/email/send.ts, so the way to keep it is for nothing to pass `replyTo`. This
 * scan fails on any new `replyTo:` in the email library or the store.
 *
 * An entry here is a sender of ADMIN notifications, with the reason.
 */
const ALLOWED: Record<string, string> = {
  // The definition of the option and its default, not a use of it.
  "lib/email/send.ts": "declares the option",
  // Addressed to Michael, so a reply from his inbox reaches the customer.
  "lib/commerce/notify.ts": "admin notices, reply-to is the customer",
};

const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => `${dir}/${f}`);
}

const SCANNED = [
  ...sources("lib/email"),
  ...sources("lib/commerce"),
  "app/actions/commerce.ts",
  "app/admin/orders/actions.ts",
  "app/api/orders/webhook/route.ts",
  "app/api/cron/order-maintenance/route.ts",
];

describe("Reply-To on order email", () => {
  it("is set only by the senders named here", () => {
    const offenders = SCANNED.filter((path) => {
      if (ALLOWED[path]) return false;
      try {
        return /\breplyTo\s*[:?]/.test(readFileSync(join(ROOT, path), "utf8"));
      } catch {
        // app/actions/commerce.ts arrives with the payment paths.
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });

  it("is never null or a literal address in notify.ts", () => {
    const text = readFileSync(join(ROOT, "lib/commerce/notify.ts"), "utf8");
    expect(text).not.toMatch(/replyTo:\s*(null|["'`])/);
  });
});
