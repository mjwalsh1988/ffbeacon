import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  maskEmailLocalPart,
  deriveDisplayName,
  scoutFallbackLabel,
  resolveUserIdentities,
} from "./user-identity";

// ---------------------------------------------------------------------------
// maskEmailLocalPart
// ---------------------------------------------------------------------------

describe("maskEmailLocalPart", () => {
  it("keeps the first two characters and appends exactly three asterisks", () => {
    expect(maskEmailLocalPart("michael")).toBe("mi***");
  });

  it("uses whatever exists plus three asterisks when fewer than two characters", () => {
    expect(maskEmailLocalPart("a")).toBe("a***");
  });

  it("returns an empty string for empty input", () => {
    expect(maskEmailLocalPart("")).toBe("");
    expect(maskEmailLocalPart("   ")).toBe("");
  });

  it("never leaks local-part length: the asterisk count is always three", () => {
    expect(maskEmailLocalPart("mi")).toBe("mi***");
    expect(maskEmailLocalPart("michaelwalsh")).toBe("mi***");
    const short = maskEmailLocalPart("mi");
    const long = maskEmailLocalPart("michaelwalsh");
    expect(short.split("*").length).toBe(long.split("*").length);
  });
});

// ---------------------------------------------------------------------------
// scoutFallbackLabel
// ---------------------------------------------------------------------------

describe("scoutFallbackLabel", () => {
  it("is deterministic for the same user id", () => {
    expect(scoutFallbackLabel("abc-123")).toBe(scoutFallbackLabel("abc-123"));
  });

  it("uses the Scout- prefix with 4 hex chars", () => {
    expect(scoutFallbackLabel("abc-123")).toMatch(/^Scout-[0-9a-f]{4}$/);
  });

  it("produces different labels for different ids", () => {
    expect(scoutFallbackLabel("user-a")).not.toBe(scoutFallbackLabel("user-b"));
  });
});

// ---------------------------------------------------------------------------
// deriveDisplayName
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  userId: "user-1",
  metaDisplayName: null as string | null,
  firstName: null as string | null,
  lastName: null as string | null,
  email: null as string | null,
};

describe("deriveDisplayName", () => {
  it("uses metaDisplayName first when present", () => {
    const name = deriveDisplayName(
      { ...BASE_INPUT, metaDisplayName: "Beacon Fan", firstName: "Mike", email: "mike@example.com" },
      "public",
    );
    expect(name).toBe("Beacon Fan");
  });

  it("formats first name plus last initial when both are present", () => {
    const name = deriveDisplayName(
      { ...BASE_INPUT, firstName: "Mike", lastName: "Walsh" },
      "private",
    );
    expect(name).toBe("Mike W.");
  });

  it("uses the first name alone when last name is missing", () => {
    const name = deriveDisplayName({ ...BASE_INPUT, firstName: "Mike" }, "private");
    expect(name).toBe("Mike");
  });

  it("uses the email local part verbatim on the private surface", () => {
    const name = deriveDisplayName({ ...BASE_INPUT, email: "michael@example.com" }, "private");
    expect(name).toBe("michael");
  });

  it("masks the email local part on the public surface", () => {
    const name = deriveDisplayName({ ...BASE_INPUT, email: "michael@example.com" }, "public");
    expect(name).toBe("mi***");
    expect(name).not.toContain("michael");
  });

  it("falls back to the scout label when nothing else is available", () => {
    const name = deriveDisplayName(BASE_INPUT, "public");
    expect(name).toBe(scoutFallbackLabel("user-1"));
  });

  it("treats whitespace-only values as missing at every step", () => {
    const name = deriveDisplayName(
      {
        userId: "user-2",
        metaDisplayName: "   ",
        firstName: "   ",
        lastName: "   ",
        email: "   ",
      },
      "public",
    );
    expect(name).toBe(scoutFallbackLabel("user-2"));
  });

  it("follows the full hierarchy order even when later steps have data", () => {
    const withDisplayName = deriveDisplayName(
      {
        userId: "user-3",
        metaDisplayName: "Display Name",
        firstName: "First",
        lastName: "Last",
        email: "email@example.com",
      },
      "public",
    );
    expect(withDisplayName).toBe("Display Name");

    const withFirstName = deriveDisplayName(
      {
        userId: "user-3",
        metaDisplayName: null,
        firstName: "First",
        lastName: "Last",
        email: "email@example.com",
      },
      "public",
    );
    expect(withFirstName).toBe("First L.");
  });
});

// ---------------------------------------------------------------------------
// resolveUserIdentities
// ---------------------------------------------------------------------------

interface PrefsRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
}

function makeAdmin(opts: {
  prefs?: PrefsRow[];
  prefsError?: unknown;
  authUsers?: Record<string, { email?: string | null; displayName?: string | null } | null>;
  authError?: boolean;
  signedUrls?: Record<string, string>;
  signedUrlsError?: unknown;
  perFileErrors?: Set<string>;
}) {
  const prefs = opts.prefs ?? [];
  const getUserById = vi.fn(async (id: string) => {
    const entry = opts.authUsers?.[id];
    if (opts.authError) return { data: { user: null }, error: { message: "auth failure" } };
    if (!entry) return { data: { user: null }, error: null };
    return {
      data: {
        user: {
          id,
          email: entry.email ?? null,
          user_metadata:
            entry.displayName !== undefined ? { display_name: entry.displayName } : {},
        },
      },
      error: null,
    };
  });

  const createSignedUrls = vi.fn(async (paths: string[]) => {
    if (opts.signedUrlsError) {
      return { data: null, error: opts.signedUrlsError };
    }
    const data = paths.map((path) => ({
      path,
      signedUrl: opts.perFileErrors?.has(path) ? null : (opts.signedUrls?.[path] ?? `signed:${path}`),
      error: opts.perFileErrors?.has(path) ? "not found" : null,
    }));
    return { data, error: null };
  });

  const from = vi.fn((table: string) => {
    if (table !== "user_preferences") {
      throw new Error(`unexpected table ${table}`);
    }
    return {
      select: () => ({
        in: (_col: string, ids: string[]) => {
          if (opts.prefsError) {
            return Promise.resolve({ data: null, error: opts.prefsError });
          }
          const filtered = prefs.filter((p) => ids.includes(p.user_id));
          return Promise.resolve({ data: filtered, error: null });
        },
      }),
    };
  });

  return {
    admin: {
      from,
      auth: { admin: { getUserById } },
      storage: { from: () => ({ createSignedUrls }) },
    } as unknown as Parameters<typeof resolveUserIdentities>[0],
    getUserById,
    createSignedUrls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveUserIdentities", () => {
  it("returns an empty map without any queries for empty input", async () => {
    const { admin, getUserById, createSignedUrls } = makeAdmin({});
    const result = await resolveUserIdentities(admin, [], "public");
    expect(result.size).toBe(0);
    expect(getUserById).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("dedupes ids, calling getUserById once per distinct id", async () => {
    const { admin, getUserById } = makeAdmin({
      authUsers: { "user-1": { email: "one@example.com" } },
    });
    await resolveUserIdentities(admin, ["user-1", "user-1", "user-1"], "public");
    expect(getUserById).toHaveBeenCalledTimes(1);
  });

  it("merges prefs and auth data correctly", async () => {
    const { admin } = makeAdmin({
      prefs: [{ user_id: "user-1", first_name: "Mike", last_name: "Walsh", avatar_path: null }],
      authUsers: { "user-1": { email: "mike@example.com", displayName: null } },
    });
    const result = await resolveUserIdentities(admin, ["user-1"], "private");
    expect(result.get("user-1")?.displayName).toBe("Mike W.");
  });

  it("prefers metaDisplayName from auth over prefs first/last name", async () => {
    const { admin } = makeAdmin({
      prefs: [{ user_id: "user-1", first_name: "Mike", last_name: "Walsh", avatar_path: null }],
      authUsers: { "user-1": { email: "mike@example.com", displayName: "Beacon Fan" } },
    });
    const result = await resolveUserIdentities(admin, ["user-1"], "public");
    expect(result.get("user-1")?.displayName).toBe("Beacon Fan");
  });

  it("batch-signs avatar paths and maps results back by path", async () => {
    const { admin, createSignedUrls } = makeAdmin({
      prefs: [
        { user_id: "user-1", first_name: null, last_name: null, avatar_path: "avatars/user-1.png" },
        { user_id: "user-2", first_name: null, last_name: null, avatar_path: "avatars/user-2.png" },
      ],
    });
    const result = await resolveUserIdentities(admin, ["user-1", "user-2"], "public");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(
      expect.arrayContaining(["avatars/user-1.png", "avatars/user-2.png"]),
      expect.any(Number),
    );
    expect(result.get("user-1")?.avatarUrl).toBe("signed:avatars/user-1.png");
    expect(result.get("user-2")?.avatarUrl).toBe("signed:avatars/user-2.png");
  });

  it("skips the storage call entirely when nobody has an avatar_path", async () => {
    const { admin, createSignedUrls } = makeAdmin({
      prefs: [{ user_id: "user-1", first_name: "Mike", last_name: null, avatar_path: null }],
    });
    const result = await resolveUserIdentities(admin, ["user-1"], "public");
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(result.get("user-1")?.avatarUrl).toBeNull();
  });

  it("degrades to prefs/fallback when the auth lookup fails", async () => {
    const { admin } = makeAdmin({
      prefs: [{ user_id: "user-1", first_name: "Mike", last_name: null, avatar_path: null }],
      authError: true,
    });
    const result = await resolveUserIdentities(admin, ["user-1"], "public");
    expect(result.get("user-1")?.displayName).toBe("Mike");
  });

  it("degrades with every id still present when the prefs query errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = makeAdmin({
      prefsError: { message: "boom" },
      authUsers: { "user-1": { email: "mike@example.com" } },
    });
    const result = await resolveUserIdentities(admin, ["user-1", "user-2"], "public");
    expect(result.has("user-1")).toBe(true);
    expect(result.has("user-2")).toBe(true);
    expect(result.get("user-1")?.displayName).toBe("mi***");
    expect(result.get("user-2")?.displayName).toBe(scoutFallbackLabel("user-2"));
    spy.mockRestore();
  });

  it("yields null avatarUrls for every affected user on a whole-call storage failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = makeAdmin({
      prefs: [
        { user_id: "user-1", first_name: null, last_name: null, avatar_path: "avatars/user-1.png" },
      ],
      signedUrlsError: { message: "storage down" },
    });
    const result = await resolveUserIdentities(admin, ["user-1"], "public");
    expect(result.get("user-1")?.avatarUrl).toBeNull();
    spy.mockRestore();
  });

  it("yields null avatarUrl for a per-file signing error without affecting other users", async () => {
    const { admin } = makeAdmin({
      prefs: [
        { user_id: "user-1", first_name: null, last_name: null, avatar_path: "avatars/user-1.png" },
        { user_id: "user-2", first_name: null, last_name: null, avatar_path: "avatars/user-2.png" },
      ],
      perFileErrors: new Set(["avatars/user-1.png"]),
    });
    const result = await resolveUserIdentities(admin, ["user-1", "user-2"], "public");
    expect(result.get("user-1")?.avatarUrl).toBeNull();
    expect(result.get("user-2")?.avatarUrl).toBe("signed:avatars/user-2.png");
  });

  it("gives every requested id a Map entry even when all lookups fail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = makeAdmin({ prefsError: { message: "boom" }, authError: true });
    const result = await resolveUserIdentities(admin, ["a", "b", "c"], "public");
    expect(result.size).toBe(3);
    for (const id of ["a", "b", "c"]) {
      expect(result.get(id)).toEqual({ displayName: scoutFallbackLabel(id), avatarUrl: null });
    }
    spy.mockRestore();
  });
});
