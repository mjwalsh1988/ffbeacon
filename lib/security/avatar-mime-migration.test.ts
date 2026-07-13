import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CI guard for the user-avatars MIME allowlist (FFB-SEC-012, migration 0138).
 * Static structure check: it fails loudly if the allowlist drifts away from the safe
 * raster set the uploader advertises, if an unsafe type is added, or if the migration
 * starts touching bucket privacy / policies. The actual Storage enforcement is verified
 * against the DB when the migration is applied (see the remediation report).
 */
const MIGRATION = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0138_user_avatars_mime_allowlist.sql"),
  "utf8",
).toLowerCase();

describe("migration 0138: user-avatars MIME allowlist", () => {
  it("allows every advertised safe raster type", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(MIGRATION).toContain(t);
    }
  });

  it("does not allow unsafe or unsupported formats", () => {
    for (const t of ["image/svg", "svg+xml", "text/html", "image/heic", "image/heif"]) {
      // These must not appear in the array grant (guard against an accidental add).
      expect(MIGRATION).not.toContain(`'${t}'`);
    }
  });

  it("targets the user-avatars bucket and only sets allowed_mime_types", () => {
    expect(MIGRATION).toMatch(/update\s+storage\.buckets/);
    expect(MIGRATION).toContain("where id = 'user-avatars'");
    expect(MIGRATION).toContain("set allowed_mime_types");
    // Must not broaden access or alter privacy/policies.
    expect(MIGRATION).not.toContain("public = true");
    expect(MIGRATION).not.toMatch(/create\s+policy/);
    expect(MIGRATION).not.toMatch(/grant\s+/);
  });
});
