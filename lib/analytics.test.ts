import { afterEach, describe, expect, it, vi } from "vitest";
import { isGoogleAnalyticsEnabled, parseAuthEventCookie, sectionOf } from "./analytics";

describe("sectionOf", () => {
  it("names known sections and never passes a handle or an id through", () => {
    expect(sectionOf("/")).toBe("home");
    expect(sectionOf("/leagues/1234567890/teams/4")).toBe("leagues");
    expect(sectionOf("/tools/manager-pulse/somebody")).toBe("tools");
    expect(sectionOf("/jane_smith")).toBe("profile");
  });
});

describe("parseAuthEventCookie", () => {
  it("reads the two events the auth callback writes", () => {
    expect(parseAuthEventCookie("sign_up.google")).toEqual({ name: "sign_up", method: "google" });
    expect(parseAuthEventCookie("login.discord")).toEqual({ name: "login", method: "discord" });
    expect(parseAuthEventCookie("login.email")).toEqual({ name: "login", method: "email" });
  });

  it("ignores anything it did not write", () => {
    expect(parseAuthEventCookie(undefined)).toBeNull();
    expect(parseAuthEventCookie("")).toBeNull();
    expect(parseAuthEventCookie("purchase.google")).toBeNull();
    expect(parseAuthEventCookie("login.")).toBeNull();
    expect(parseAuthEventCookie("login.Google")).toBeNull();
    expect(parseAuthEventCookie("login.someone@example.com")).toBeNull();
    expect(parseAuthEventCookie(`login.${"a".repeat(33)}`)).toBeNull();
  });
});

describe("isGoogleAnalyticsEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on in production only", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isGoogleAnalyticsEnabled()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isGoogleAnalyticsEnabled()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "");
    expect(isGoogleAnalyticsEnabled()).toBe(false);
  });
});
