import { describe, expect, it } from "vitest";
import { PROFILE_CHUNK, profileHrefFor, resolveLiveProfileHandles } from "./profile-links";

type Sig = { user_id: string; handle: string; status: string; visibility: string; hidden: boolean };

function client(signals: Sig[]) {
  const calls: string[][] = [];
  return {
    calls,
    admin: {
      from: () => {
        let ids: string[] = [];
        const eqs: Array<[string, unknown]> = [];
        const api = {
          select: () => api,
          in: (_c: string, v: string[]) => {
            ids = v;
            calls.push(v);
            return api;
          },
          eq: (c: string, v: unknown) => {
            eqs.push([c, v]);
            return api;
          },
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(
              resolve({
                data: signals.filter(
                  (s) => ids.includes(s.user_id) && eqs.every(([c, v]) => (s as unknown as Record<string, unknown>)[c] === v),
                ),
                error: null,
              }),
            ),
        };
        return api;
      },
    } as never,
  };
}

const live = (id: string): Sig => ({ user_id: id, handle: `h${id}`, status: "published", visibility: "public", hidden: false });

describe("resolveLiveProfileHandles", () => {
  it("maps only live profiles", async () => {
    const { admin } = client([
      live("a"),
      { ...live("b"), visibility: "private" },
      { ...live("c"), hidden: true },
      { ...live("d"), status: "draft" },
    ]);
    const map = await resolveLiveProfileHandles(admin, ["a", "b", "c", "d"]);
    expect([...map.keys()]).toEqual(["a"]);
    expect(profileHrefFor(map, "a")).toBe("/u/ha");
    expect(profileHrefFor(map, "b")).toBeNull();
  });

  it("chunks at 200 ids", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const { admin, calls } = client([]);
    await resolveLiveProfileHandles(admin, ids);
    expect(calls.map((c) => c.length)).toEqual([PROFILE_CHUNK, PROFILE_CHUNK, 50]);
  });
});
