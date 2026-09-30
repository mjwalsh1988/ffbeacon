import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  }),
}));

const FORMATS = [
  { id: "f1", slug: "redraft-ppr-std" },
  { id: "f2", slug: "dynasty-ppr-sflex" },
];
vi.mock("@/lib/source", () => ({
  readSourceSlug: (v: unknown) => (typeof v === "string" ? v : null),
  getAvailableSources: async () => [],
  pickDefaultSource: () => null,
  getActiveFormats: async () => FORMATS,
}));

import { FORMAT_COOKIE, resolveFormatSlug } from "./preferences";
import { DEFAULT_FORMAT_SLUG } from "@/lib/site";

let prefFormatId: string | null = null;
let signedIn = false;

function client() {
  return {
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: "u1" } : null } }),
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { default_source_slug: null, default_format_config_id: prefFormatId },
        }),
      };
      return chain;
    },
  } as unknown as Parameters<typeof resolveFormatSlug>[0];
}

describe("resolveFormatSlug", () => {
  beforeEach(() => {
    cookieJar.clear();
    prefFormatId = null;
    signedIn = false;
  });

  it("accepts a known format from the URL", async () => {
    const out = await resolveFormatSlug(client(), "dynasty-ppr-sflex");
    expect(out).toEqual({ slug: "dynasty-ppr-sflex", origin: "url", transient: true });
  });

  it("ignores an unknown URL format and falls to the default", async () => {
    const out = await resolveFormatSlug(client(), "foo");
    expect(out.slug).toBe(DEFAULT_FORMAT_SLUG);
    expect(out.origin).toBe("default");
  });

  it("falls from an unknown URL format to the saved DB format", async () => {
    signedIn = true;
    prefFormatId = "f2";
    const out = await resolveFormatSlug(client(), "foo");
    expect(out).toEqual({ slug: "dynasty-ppr-sflex", origin: "db", transient: false });
  });

  it("falls from an unknown URL format to a known cookie", async () => {
    cookieJar.set(FORMAT_COOKIE, "dynasty-ppr-sflex");
    const out = await resolveFormatSlug(client(), "foo");
    expect(out.origin).toBe("cookie");
    expect(out.slug).toBe("dynasty-ppr-sflex");
  });

  it("ignores an unknown cookie", async () => {
    cookieJar.set(FORMAT_COOKIE, "retired-format");
    const out = await resolveFormatSlug(client(), undefined);
    expect(out.origin).toBe("default");
  });
});
