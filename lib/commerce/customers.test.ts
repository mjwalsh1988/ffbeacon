import { describe, expect, it, vi } from "vitest";
import { lookupCustomers, searchCustomers } from "./customers";

function fakeAdmin(identities: unknown[], prefs: unknown[]) {
  const rpc = vi.fn(async () => ({ data: identities, error: null }));
  const inFn = vi.fn(async () => ({ data: prefs, error: null }));
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { admin: { rpc, from } as never, rpc, from };
}

describe("lookupCustomers", () => {
  it("feeds the display name hierarchy: metadata, then first and last, then email", async () => {
    const fake = fakeAdmin(
      [
        { user_id: "a", email: "a@example.com", meta_display_name: "Ace", created_at: "t" },
        { user_id: "b", email: "bea@example.com", meta_display_name: null, created_at: "t" },
        { user_id: "c", email: "cam@example.com", meta_display_name: null, created_at: "t" },
      ],
      [{ user_id: "b", first_name: "Bea", last_name: "Long" }],
    );
    const map = await lookupCustomers(fake.admin, ["a", "b", "c"]);
    expect(map.get("a")?.displayName).toBe("Ace");
    expect(map.get("b")?.displayName).toBe("Bea L.");
    expect(map.get("c")?.displayName).toBe("cam");
    expect(map.get("c")?.email).toBe("cam@example.com");
  });

  it("makes one RPC call and one preferences read for N ids", async () => {
    const fake = fakeAdmin([], []);
    await lookupCustomers(fake.admin, ["a", "b", "c", "a", null]);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith("order_customer_identities", {
      p_user_ids: ["a", "b", "c"],
    });
    expect(fake.from).toHaveBeenCalledTimes(1);
  });

  it("makes no call at all for no ids", async () => {
    const fake = fakeAdmin([], []);
    expect((await lookupCustomers(fake.admin, [])).size).toBe(0);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe("searchCustomers", () => {
  it("refuses a one-character search without calling", async () => {
    const fake = fakeAdmin([], []);
    expect(await searchCustomers(fake.admin, " a ")).toEqual([]);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("maps the rows", async () => {
    const fake = fakeAdmin([{ user_id: "a", email: "a@example.com" }], []);
    expect(await searchCustomers(fake.admin, "exam")).toEqual([
      { userId: "a", email: "a@example.com" },
    ]);
  });
});
