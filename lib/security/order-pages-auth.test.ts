import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the Beacon Store: every admin page and action is behind
 * requireAdmin, the customer pages read through the session client so RLS is what
 * scopes them, nothing pages the Auth user list, and no email address reaches a log
 * line. Same shape as lib/security/league-refresh-public.test.ts.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function walk(dir: string): string[] {
  const full = resolve(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    const path = join(dir, name);
    return statSync(resolve(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

const adminPages = walk("app/admin/orders").filter((p) => p.endsWith("page.tsx"));

describe("admin order pages", () => {
  it("finds the six pages", () => {
    expect(adminPages).toHaveLength(6);
  });

  it.each(adminPages)("%s calls requireAdmin", (page) => {
    expect(read(page)).toContain("await requireAdmin(");
  });
});

describe("admin order actions", () => {
  const source = read("app/admin/orders/actions.ts");
  const bodies = source.split(/^export async function /m).slice(1);

  it("exports every action", () => {
    expect(bodies.length).toBeGreaterThanOrEqual(24);
  });

  it.each(bodies.map((b) => [b.slice(0, b.indexOf("(")), b]))(
    "%s calls requireAdmin first",
    (name, body) => {
      if (name === "saveCouponAction" || name === "createCouponAction") {
        expect(body).toContain("writeCoupon(");
        return;
      }
      const opening = body.indexOf("{\n");
      expect(body.slice(opening, opening + 120)).toContain("await requireAdmin(");
    },
  );

  it("guards the shared coupon writer", () => {
    const writer = source.slice(source.indexOf("async function writeCoupon"));
    expect(writer.slice(0, 200)).toContain("await requireAdmin(");
  });
});

describe("customer order pages", () => {
  const pages = ["app/my-beacon/orders/page.tsx", "app/my-beacon/orders/[order_id]/page.tsx"];

  it.each(pages)("%s reads through the session client", (page) => {
    const source = read(page);
    expect(source).toContain("createClient()");
    expect(source).not.toContain("listOrdersForAdmin");
    expect(source).not.toContain("loadOrderForAdmin");
  });

  it("gives the owner reads the session client, not the admin one", () => {
    const source = read("app/my-beacon/orders/[order_id]/page.tsx");
    expect(source).toContain("loadOrderForOwner(supabase");
    expect(source).not.toContain("loadOrderForOwner(admin");
  });
});

const storeSources = [
  ...walk("lib/commerce"),
  ...walk("app/admin/orders"),
  ...walk("app/my-beacon/orders"),
  ...walk("components/commerce"),
  "app/actions/commerce.ts",
  "app/api/orders/webhook/route.ts",
].filter((p) => !p.endsWith(".test.ts"));

describe("the store as a whole", () => {
  it.each(storeSources)("%s never lists Auth users", (path) => {
    const code = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\.listUsers\s*\(/);
  });

  it.each(storeSources)("%s logs no email address", (path) => {
    const logs = read(path).match(/console\.(log|warn|error)\([^;]*;/g) ?? [];
    for (const line of logs) expect(line).not.toMatch(/\bemail\b|customerEmail|\.to\b/i);
  });
});

describe("the attachment files route", () => {
  const route = read("app/api/orders/[order_id]/files/[deliverable_id]/route.ts");

  it("checks the owner or an admin, and only for a published, ready file", () => {
    expect(route).toContain("getIsAdmin");
    expect(route).toContain('file.status === "published"');
    expect(route).toContain('file.upload_state === "ready"');
    expect(route).toContain("createSignedUrl(file.storage_path, 60)");
  });
});
