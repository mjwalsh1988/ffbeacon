import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CI guards for the public-refresh reclassification (FFB-SEC-004 / FFB-SEC-007).
 * Static structure checks that complement the DB integration harness at
 * supabase/tests/security/league_refresh_rpc_grants.test.sql. They fail loudly if
 * anyone reintroduces a commissioner/admin gate on the public refresh route or
 * re-grants the cooldown RPC to untrusted roles.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("public league refresh route", () => {
  const route = read("app/api/leagues/[league_id]/refresh/route.ts");

  it("does not depend on the commissioner/admin authorization helper", () => {
    expect(route).not.toContain("league-auth");
    expect(route).not.toContain("getLeagueAdminContext");
    expect(route).not.toContain("canForceRefresh");
  });

  it("does not gate on authentication (guests may refresh)", () => {
    expect(route).not.toContain("Authentication required");
    expect(route).not.toMatch(/status:\s*401/);
  });

  it("still claims the shared cooldown via the service-role client", () => {
    expect(route).toContain("try_claim_league_refresh");
    expect(route).toContain("createAdminClient");
    // The actor id is derived server-side, never trusted from the body.
    expect(route).toMatch(/p_user_id:\s*user\?\.id\s*\?\?\s*null/);
  });

  it("keeps the same-origin header defense and a numeric cooldown", () => {
    expect(route).toContain("x-requested-with");
    expect(route).toMatch(/RATE_LIMIT_SECONDS\s*=\s*\d+/);
  });
});

describe("migration 0134: refresh RPC execute hardening", () => {
  const migration = read(
    "supabase/migrations/0134_league_refresh_rpc_execute_hardening.sql",
  ).toLowerCase();

  it("revokes EXECUTE from anon, authenticated, and public", () => {
    expect(migration).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.try_claim_league_refresh\([^)]*\)\s+from\s+anon,\s*authenticated,\s*public/,
    );
  });
});
