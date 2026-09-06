import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return { ...actual, getSleeperUser: vi.fn() };
});

// The pre-0268 backfill is metered, so the resolver reaches for request
// headers and the rate-limit RPC. Neither exists under vitest, and without
// these the claim fails closed and the backfill never runs, which would make
// the tests below assert the opposite of what they are named for.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: true, error: null }) }),
}));
vi.mock("@/lib/rate-limit-actor", () => ({
  resolveRateLimitActorKey: async () => "user:test",
}));

import { getSleeperUser } from "@/lib/sleeper";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
  resolveHandleGate,
  resolveSleeperViewer,
} from "./resolve";
import type { SavedSleeperHandle } from "./types";

const mockGetSleeperUser = vi.mocked(getSleeperUser);

beforeEach(() => {
  mockGetSleeperUser.mockReset();
});

/**
 * A Supabase stand-in that answers exactly the two things the resolver asks
 * of it: who the reader is, and what their preferences row holds. `updates`
 * records every write, which is how the "writes on success, not on failure"
 * pair below is asserted.
 */
function stubClient(opts: {
  user?: { id: string } | null;
  settings?: Record<string, unknown> | null;
  authThrows?: boolean;
}) {
  const updates: Record<string, unknown>[] = [];
  const client = {
    auth: {
      getUser: async () => {
        if (opts.authThrows) throw new Error("session broken");
        return { data: { user: opts.user ?? null } };
      },
    },
    from() {
      const builder = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => ({
          data:
            opts.settings === undefined
              ? null
              : { sleeper_league_settings: opts.settings },
        }),
        // The update chain is awaited without maybeSingle().
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
  };
  // The resolver only ever touches the two members above; the cast keeps the
  // stub honest about that rather than building a whole client.
  return { client: client as never, updates };
}

const SAVED = { username: "BeaconMike", sleeper_user_id: "111" };

describe("loadSavedSleeperHandle", () => {
  it("returns null for a signed-out reader", async () => {
    const { client } = stubClient({ user: null });
    expect(await loadSavedSleeperHandle(client)).toBeNull();
  });

  it("returns null when the reader saved nothing", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: {} });
    expect(await loadSavedSleeperHandle(client)).toBeNull();
  });

  it("reads a legacy row with only a username", async () => {
    const { client } = stubClient({
      user: { id: "u1" },
      settings: { username: "beacon" },
    });
    expect(await loadSavedSleeperHandle(client)).toEqual({
      username: "beacon",
      sleeperUserId: null,
      displayName: null,
      avatar: null,
      verifiedAt: null,
    });
  });

  it("reads the full identity", async () => {
    const { client } = stubClient({
      user: { id: "u1" },
      settings: {
        username: "beacon",
        sleeper_user_id: "111",
        sleeper_display_name: "Beacon Mike",
        sleeper_avatar: "abc",
        handle_verified_at: "2026-09-05T00:00:00.000Z",
      },
    });
    expect(await loadSavedSleeperHandle(client)).toEqual({
      username: "beacon",
      sleeperUserId: "111",
      displayName: "Beacon Mike",
      avatar: "abc",
      verifiedAt: "2026-09-05T00:00:00.000Z",
    });
  });

  it("returns null rather than throwing when the session read breaks", async () => {
    const { client } = stubClient({ authThrows: true });
    expect(await loadSavedSleeperHandle(client)).toBeNull();
  });
});

describe("resolveSleeperViewer", () => {
  it("lets the URL win over the saved handle", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const viewer = await resolveSleeperViewer(client, "someone_else");
    expect(viewer).toEqual({
      username: "someone_else",
      sleeperUserId: null,
      displayName: null,
      avatar: null,
      source: "url",
    });
  });

  it("carries the cached id across when the URL names the saved handle, case-insensitively", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const viewer = await resolveSleeperViewer(client, "beaconmike");
    expect(viewer?.source).toBe("url");
    expect(viewer?.sleeperUserId).toBe("111");
  });

  it("falls back to the saved handle with no param", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const viewer = await resolveSleeperViewer(client, undefined);
    expect(viewer).toMatchObject({ username: "BeaconMike", source: "saved" });
  });

  it("treats an empty or whitespace param as absent", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    expect((await resolveSleeperViewer(client, ""))?.source).toBe("saved");
    expect((await resolveSleeperViewer(client, "   "))?.source).toBe("saved");
  });

  it("reads the first entry of a repeated param", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const viewer = await resolveSleeperViewer(client, ["first", "second"]);
    expect(viewer?.username).toBe("first");
  });

  it("returns null for a guest on a clean URL", async () => {
    const { client } = stubClient({ user: null });
    expect(await resolveSleeperViewer(client, undefined)).toBeNull();
  });

  it("still honours the URL for a guest", async () => {
    const { client } = stubClient({ user: null });
    const viewer = await resolveSleeperViewer(client, "someone");
    expect(viewer).toMatchObject({ username: "someone", source: "url" });
  });
});

describe("resolveHandleGate", () => {
  it("is guest when signed out", async () => {
    const { client } = stubClient({ user: null });
    expect(await resolveHandleGate(client, undefined)).toEqual({
      kind: "guest",
    });
  });

  it("is member-unsaved when signed in with nothing saved", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: {} });
    expect(await resolveHandleGate(client, undefined)).toEqual({
      kind: "member-unsaved",
    });
  });

  it("is member-saved on a clean URL", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const gate = await resolveHandleGate(client, undefined);
    expect(gate.kind).toBe("member-saved");
  });

  it("is member-overridden when the URL names someone else", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const gate = await resolveHandleGate(client, "rival");
    expect(gate.kind).toBe("member-overridden");
    if (gate.kind === "member-overridden") {
      expect(gate.viewer.username).toBe("rival");
      expect(gate.handle.username).toBe("BeaconMike");
    }
  });

  it("is member-saved when the URL names the reader's own handle", async () => {
    const { client } = stubClient({ user: { id: "u1" }, settings: SAVED });
    const gate = await resolveHandleGate(client, "BEACONMIKE");
    expect(gate.kind).toBe("member-saved");
  });
});

describe("ensureSleeperUserId", () => {
  const legacy: SavedSleeperHandle = {
    username: "beacon",
    sleeperUserId: null,
    displayName: null,
    avatar: null,
    verifiedAt: null,
  };

  it("does nothing when the id is already there", async () => {
    const { client, updates } = stubClient({ user: { id: "u1" } });
    const filled = { ...legacy, sleeperUserId: "111" };
    expect(await ensureSleeperUserId(client, filled)).toBe(filled);
    expect(mockGetSleeperUser).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("resolves and writes the identity back on success", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "111",
      username: "beacon",
      display_name: "Beacon Mike",
      avatar: "abc",
    });
    const { client, updates } = stubClient({
      user: { id: "u1" },
      settings: { username: "beacon", signal_league_ids: ["999"] },
    });
    const result = await ensureSleeperUserId(client, legacy);
    expect(result.sleeperUserId).toBe("111");
    expect(result.displayName).toBe("Beacon Mike");
    expect(updates).toHaveLength(1);
    const written = updates[0].sleeper_league_settings as Record<
      string,
      unknown
    >;
    expect(written.sleeper_user_id).toBe("111");
    // Sibling keys survive the merge.
    expect(written.signal_league_ids).toEqual(["999"]);
    expect(written.username).toBe("beacon");
  });

  it("writes nothing and keeps the handle when Sleeper does not answer", async () => {
    mockGetSleeperUser.mockResolvedValue(null);
    const { client, updates } = stubClient({
      user: { id: "u1" },
      settings: { username: "beacon" },
    });
    expect(await ensureSleeperUserId(client, legacy)).toEqual(legacy);
    expect(updates).toHaveLength(0);
  });

  it("writes nothing when the Sleeper call throws", async () => {
    mockGetSleeperUser.mockRejectedValue(new Error("network"));
    const { client, updates } = stubClient({
      user: { id: "u1" },
      settings: { username: "beacon" },
    });
    expect(await ensureSleeperUserId(client, legacy)).toEqual(legacy);
    expect(updates).toHaveLength(0);
  });

  it("refuses a stored handle that no longer passes the grammar", async () => {
    const { client, updates } = stubClient({ user: { id: "u1" } });
    const bad: SavedSleeperHandle = { ...legacy, username: "not a handle" };
    expect(await ensureSleeperUserId(client, bad)).toBe(bad);
    expect(mockGetSleeperUser).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

describe("the pre-0268 backfill reaches the league deep views", () => {
  /**
   * The regression this guards is the whole justification for the feature.
   *
   * The ten league deep views resolve their viewer through
   * `resolveSleeperViewer` and nothing else. A row saved before migration 0268
   * carries a null `sleeper_user_id`, and `matchViewerRoster` only prefers the
   * id when it has one; with a null it falls through to matching the saved
   * USERNAME against `league_users.display_name`, which Sleeper allows to be a
   * different string. A reader whose two names differ then sees no team
   * highlighted anywhere, which is exactly the defect the build exists to fix.
   *
   * So the fill has to happen inside the resolver, not at each caller.
   */
  it("fills the id for a legacy row so the viewer carries one", async () => {
    mockGetSleeperUser.mockResolvedValue({
      user_id: "222",
      username: "beacon",
      display_name: "Beacon Mike",
      avatar: "abc",
    });
    const { client, updates } = stubClient({
      user: { id: "u1" },
      settings: { username: "beacon" },
    });

    const viewer = await resolveSleeperViewer(client, undefined);
    expect(viewer?.sleeperUserId).toBe("222");
    expect(viewer?.displayName).toBe("Beacon Mike");
    // And it was written back, so the next visit costs no Sleeper call.
    expect(updates).toHaveLength(1);
  });

  it("still resolves a viewer when Sleeper cannot fill the id", async () => {
    mockGetSleeperUser.mockResolvedValue(null);
    const { client, updates } = stubClient({
      user: { id: "u1" },
      settings: { username: "beacon" },
    });

    const viewer = await resolveSleeperViewer(client, undefined);
    // The handle still works; only the id-first match is unavailable, which is
    // the pre-existing display-name behaviour rather than a broken page.
    expect(viewer?.username).toBe("beacon");
    expect(viewer?.sleeperUserId).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it("does not spend a Sleeper call for a URL guest", async () => {
    const { client } = stubClient({ user: null });
    const viewer = await resolveSleeperViewer(client, "someone_else");
    expect(viewer?.username).toBe("someone_else");
    expect(mockGetSleeperUser).not.toHaveBeenCalled();
  });
});
