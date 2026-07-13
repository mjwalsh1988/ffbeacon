import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CI guard for the FFB-SEC-001 / FFB-SEC-014 fix (migration 0133).
 *
 * This is intentionally a STATIC structure check, not a security proof. The real
 * security property lives in PostgreSQL GRANTs, RLS, and a trigger, and is exercised
 * by the integration harness at supabase/tests/security/is_admin_write_hardening.test.sql
 * (run against a branch/local DB with psql). This test only fails CI loudly if the
 * migration is ever edited in a way that drops one of the required controls, so a
 * regression cannot land silently.
 */
const MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/0133_user_preferences_is_admin_write_hardening.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 0133: is_admin write hardening", () => {
  it("guards INSERT as well as UPDATE", () => {
    expect(MIGRATION).toMatch(/before\s+insert\s+or\s+update\s+on\s+public\.user_preferences/);
  });

  it("uses SECURITY INVOKER so current_user reflects the PostgREST role", () => {
    expect(MIGRATION).toContain("security invoker");
  });

  it("rejects is_admin writes from the anon/authenticated roles (fail closed)", () => {
    expect(MIGRATION).toMatch(/current_user\s+in\s*\(\s*'anon'\s*,\s*'authenticated'\s*\)/);
    expect(MIGRATION).toContain("raise exception");
  });

  it("revokes table-level INSERT/UPDATE from anon and authenticated", () => {
    expect(MIGRATION).toMatch(
      /revoke\s+insert,\s*update\s+on\s+public\.user_preferences\s+from\s+anon,\s*authenticated/,
    );
  });

  it("explicitly revokes the is_admin column write grants", () => {
    expect(MIGRATION).toMatch(
      /revoke\s+insert\s*\(is_admin\),\s*update\s*\(is_admin\)\s+on\s+public\.user_preferences\s+from\s+anon,\s*authenticated/,
    );
  });

  it("re-grants only non-admin columns to authenticated (never is_admin)", () => {
    const grantBlocks = MIGRATION.match(/grant\s+(insert|update)\s*\(([\s\S]*?)\)\s+on\s+public\.user_preferences\s+to\s+authenticated/g);
    expect(grantBlocks, "expected column-scoped grants to authenticated").toBeTruthy();
    expect(grantBlocks!.length).toBe(2); // one INSERT grant, one UPDATE grant
    for (const block of grantBlocks!) {
      expect(block).not.toMatch(/\bis_admin\b/);
      // sanity: the legitimate columns the app writes must be present
      expect(block).toContain("default_source_slug");
      expect(block).toContain("sleeper_league_settings");
      expect(block).toContain("avatar_path");
    }
  });
});
