import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_CENTS,
  MIN_AMOUNT_CENTS,
  centsToDecimalString,
  formatUsd,
  parseDonationAmount,
} from "./amounts";
import { paypalUrl, venmoUrl } from "./links";
import { safeReturnPath } from "./return-path";

const ORIGIN = "https://ffbeacon.com";

describe("parseDonationAmount", () => {
  it("takes the preset amounts as numbers", () => {
    for (const dollars of [5, 10, 25, 50, 100]) {
      expect(parseDonationAmount(dollars)).toEqual({ ok: true, cents: dollars * 100 });
    }
  });

  it("takes what people actually type", () => {
    expect(parseDonationAmount(" 25 ")).toEqual({ ok: true, cents: 2500 });
    expect(parseDonationAmount("$25")).toEqual({ ok: true, cents: 2500 });
    expect(parseDonationAmount("1,000")).toEqual({ ok: true, cents: 100000 });
    expect(parseDonationAmount("12.50")).toEqual({ ok: true, cents: 1250 });
    expect(parseDonationAmount("12.5")).toEqual({ ok: true, cents: 1250 });
  });

  // The reason cents exist at all in this module. 10.1 * 100 is 1009.999... in
  // binary floating point, and a truncating conversion would charge $10.09.
  it("rounds decimal dollars to the right cent", () => {
    expect(parseDonationAmount("10.10")).toEqual({ ok: true, cents: 1010 });
    expect(parseDonationAmount("1.15")).toEqual({ ok: true, cents: 115 });
    expect(parseDonationAmount("70.07")).toEqual({ ok: true, cents: 7007 });
  });

  /**
   * The comma cases, which are the ones that cost real money.
   *
   * Most of the world writes twelve dollars fifty as "12,50". Stripping commas
   * and then validating turns that into 1250, a hundred times what its owner
   * meant, and the form's job is to move money. A comma is therefore allowed
   * only where a thousands separator actually goes.
   */
  it("refuses a comma used as a decimal separator", () => {
    for (const bad of ["12,50", "0,50", ",,25", "1,0,0,0", "1,00", ",000", "1,0000"]) {
      expect(parseDonationAmount(bad), bad).toEqual({
        ok: false,
        error: "Enter a dollar amount, like 25 or 12.50.",
      });
    }
  });

  it("still accepts a properly grouped thousands separator", () => {
    expect(parseDonationAmount("1,000")).toEqual({ ok: true, cents: 100000 });
    expect(parseDonationAmount("10,000")).toEqual({ ok: true, cents: 1000000 });
    expect(parseDonationAmount("1,000.50")).toEqual({ ok: true, cents: 100050 });
  });

  it("refuses anything that is not a plain dollar amount", () => {
    for (const bad of ["", "   ", "abc", "-5", "1e3", "5.005", "5..5", "5 5", "٥"]) {
      expect(parseDonationAmount(bad).ok, `${bad} should be refused`).toBe(false);
    }
    expect(parseDonationAmount(null).ok).toBe(false);
    expect(parseDonationAmount(undefined).ok).toBe(false);
    expect(parseDonationAmount({}).ok).toBe(false);
    expect(parseDonationAmount(Number.NaN).ok).toBe(false);
    expect(parseDonationAmount(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("holds the floor and the ceiling exactly", () => {
    expect(parseDonationAmount("0.99").ok).toBe(false);
    expect(parseDonationAmount("1")).toEqual({ ok: true, cents: MIN_AMOUNT_CENTS });
    expect(parseDonationAmount("10000")).toEqual({ ok: true, cents: MAX_AMOUNT_CENTS });
    expect(parseDonationAmount("10000.01").ok).toBe(false);
  });
});

describe("formatUsd", () => {
  it("drops the cents when there are none", () => {
    expect(formatUsd(2500)).toBe("$25");
    expect(formatUsd(100)).toBe("$1");
    expect(formatUsd(1000000)).toBe("$10,000");
  });

  it("keeps both digits when there are cents", () => {
    expect(formatUsd(1250)).toBe("$12.50");
    expect(formatUsd(115)).toBe("$1.15");
  });
});

describe("payment links", () => {
  it("puts the amount in the PayPal path with an explicit currency", () => {
    expect(paypalUrl(2500)).toBe("https://www.paypal.com/paypalme/mjwalsh1988/25USD");
    expect(paypalUrl(1250)).toBe("https://www.paypal.com/paypalme/mjwalsh1988/12.50USD");
  });

  it("builds a private Venmo payment carrying the amount and a note", () => {
    const url = new URL(venmoUrl(2500));
    expect(url.origin).toBe("https://venmo.com");
    expect(url.searchParams.get("txn")).toBe("pay");
    expect(url.searchParams.get("recipients")).toBe("mjwalsh1988");
    expect(url.searchParams.get("amount")).toBe("25");
    expect(url.searchParams.get("audience")).toBe("private");
    expect(url.searchParams.get("note")).toBe("FF Beacon donation");
  });

  it("never emits a trailing .00, which both services read as an amount anyway", () => {
    expect(centsToDecimalString(2500)).toBe("25");
    expect(centsToDecimalString(1250)).toBe("12.50");
  });
});

describe("safeReturnPath", () => {
  it("keeps a real path, with its query", () => {
    expect(safeReturnPath("/rankings", ORIGIN)).toBe("/rankings");
    expect(safeReturnPath("/leagues/123?tab=teams", ORIGIN)).toBe("/leagues/123?tab=teams");
  });

  // The whole reason the function exists. Every one of these, unchecked, would
  // be handed to Stripe as a cancel_url and redirected to from our own domain.
  it("refuses anything that could land off our origin", () => {
    for (const bad of [
      "https://evil.example/pwned",
      "//evil.example/pwned",
      "/\\evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "\t/rankings",
      "\n//evil.example",
      "rankings",
      "",
      "   ",
      `/${"a".repeat(600)}`,
    ]) {
      expect(safeReturnPath(bad, ORIGIN), `${JSON.stringify(bad)} should fall back`).toBe(
        "/",
      );
    }
    expect(safeReturnPath(null, ORIGIN)).toBe("/");
    expect(safeReturnPath(42, ORIGIN)).toBe("/");
  });

  it("drops a fragment rather than passing it through", () => {
    expect(safeReturnPath("/about#donate", ORIGIN)).toBe("/about");
  });

  /**
   * The output can go protocol-relative even when the input did not.
   * `/..//evil.example` clears every input check and URL normalisation collapses
   * it to the pathname `//evil.example`. Same-origin for our one caller, which
   * prefixes an absolute origin, and a live open redirect for any caller that
   * uses the result as a bare Location or href.
   */
  it("never returns a protocol-relative path, however it was reached", () => {
    for (const bad of ["/..//evil.example", "/./..//evil.example", "/a/../..//evil.example"]) {
      expect(safeReturnPath(bad, ORIGIN), bad).toBe("/");
    }
  });

  it("tolerates a site origin with a trailing slash", () => {
    expect(safeReturnPath("/rankings", "https://ffbeacon.com/")).toBe("/rankings");
  });
});
