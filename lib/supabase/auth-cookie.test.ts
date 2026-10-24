import { describe, it, expect } from "vitest";
import { hasSupabaseAuthCookie, supabaseAuthCookiePrefix } from "./auth-cookie";

const URL = "https://cilvpyivysjxpxbudkfa.supabase.co";

describe("supabaseAuthCookiePrefix", () => {
  it("derives the prefix from the project ref in the URL", () => {
    expect(supabaseAuthCookiePrefix(URL)).toBe(
      "sb-cilvpyivysjxpxbudkfa-auth-token",
    );
  });

  it("returns null for a missing or malformed URL", () => {
    expect(supabaseAuthCookiePrefix(undefined)).toBeNull();
    expect(supabaseAuthCookiePrefix("")).toBeNull();
    expect(supabaseAuthCookiePrefix("not a url")).toBeNull();
  });
});

describe("hasSupabaseAuthCookie", () => {
  it("finds the plain auth cookie", () => {
    expect(
      hasSupabaseAuthCookie(
        "ffbeacon.ranker_guest=abc; sb-cilvpyivysjxpxbudkfa-auth-token=eyJ",
        URL,
      ),
    ).toBe(true);
  });

  it("finds a chunked auth cookie", () => {
    expect(
      hasSupabaseAuthCookie("sb-cilvpyivysjxpxbudkfa-auth-token.0=eyJ", URL),
    ).toBe(true);
  });

  it("ignores a cookie from a different Supabase project", () => {
    expect(
      hasSupabaseAuthCookie("sb-otherprojectref-auth-token=eyJ", URL),
    ).toBe(false);
  });

  it("ignores the PKCE code verifier cookie an abandoned sign-in leaves", () => {
    expect(
      hasSupabaseAuthCookie(
        "sb-cilvpyivysjxpxbudkfa-auth-token-code-verifier=abc",
        URL,
      ),
    ).toBe(false);
  });

  it("ignores a cookie whose VALUE merely contains the prefix", () => {
    expect(
      hasSupabaseAuthCookie("note=sb-cilvpyivysjxpxbudkfa-auth-token", URL),
    ).toBe(false);
  });

  it("is false for an empty jar, a missing jar, or a missing URL", () => {
    expect(hasSupabaseAuthCookie("", URL)).toBe(false);
    expect(hasSupabaseAuthCookie(null, URL)).toBe(false);
    expect(hasSupabaseAuthCookie(undefined, URL)).toBe(false);
    expect(
      hasSupabaseAuthCookie("sb-cilvpyivysjxpxbudkfa-auth-token=eyJ", undefined),
    ).toBe(false);
  });

  it("tolerates whitespace and empty segments", () => {
    expect(
      hasSupabaseAuthCookie(
        " a=1 ;; sb-cilvpyivysjxpxbudkfa-auth-token.1=eyJ ; ",
        URL,
      ),
    ).toBe(true);
  });
});
