import { describe, expect, it } from "vitest";
import { LOGIN_ERROR_MESSAGES, loginErrorCodeFor, loginErrorMessage } from "./login-errors";

describe("loginErrorMessage", () => {
  it("returns the fixed message for each known code", () => {
    for (const [code, message] of Object.entries(LOGIN_ERROR_MESSAGES)) {
      expect(loginErrorMessage(code)).toBe(message);
    }
  });

  it("never echoes an unknown value from the URL", () => {
    const planted = "Your account is locked. Call 555 0100 to restore it.";
    expect(loginErrorMessage(planted)).toBe(LOGIN_ERROR_MESSAGES.auth_failed);
    expect(loginErrorMessage("toString")).toBe(LOGIN_ERROR_MESSAGES.auth_failed);
    expect(loginErrorMessage("__proto__")).toBe(LOGIN_ERROR_MESSAGES.auth_failed);
    expect(loginErrorMessage(undefined)).toBe(LOGIN_ERROR_MESSAGES.auth_failed);
  });
});

describe("loginErrorCodeFor", () => {
  it("maps stale-link auth codes to link_expired", () => {
    expect(loginErrorCodeFor({ code: "otp_expired" })).toBe("link_expired");
    expect(loginErrorCodeFor({ code: "flow_state_not_found" })).toBe("link_expired");
  });

  it("maps everything else to the generic code, ignoring the message", () => {
    expect(loginErrorCodeFor({ code: "something_new" })).toBe("auth_failed");
    expect(loginErrorCodeFor({})).toBe("auth_failed");
    expect(loginErrorCodeFor(null)).toBe("auth_failed");
    const withMessage = { code: undefined, message: "otp_expired" } as { code?: unknown };
    expect(loginErrorCodeFor(withMessage)).toBe("auth_failed");
  });

  it("only ever produces a code the login form knows", () => {
    for (const input of [{ code: "otp_expired" }, { code: "x" }, null]) {
      expect(Object.keys(LOGIN_ERROR_MESSAGES)).toContain(loginErrorCodeFor(input));
    }
  });
});
