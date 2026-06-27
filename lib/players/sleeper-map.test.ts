import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mapSleeperToPlayerIds } from "./sleeper-map";

/**
 * Minimal mock of the supabase query chain used by mapSleeperToPlayerIds:
 *   client.from("players").select("id, external_ids").or(filterString)
 * It records every filter string passed to .or() so we can assert sanitization,
 * and returns fixture rows for the requested ids that exist in the fixture.
 */
function makeClient(
  fixture: Record<string, string>,
  opts: { fail?: boolean } = {},
): { client: SupabaseClient<Database>; captured: string[] } {
  const captured: string[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("players");
      return {
        select(_cols: string) {
          return {
            or(filter: string) {
              captured.push(filter);
              if (opts.fail) return Promise.resolve({ data: null, error: { message: "boom" } });
              const wanted = filter
                .split(",")
                .map((f) => f.replace("external_ids->>sleeper.eq.", ""));
              const data = wanted
                .filter((id) => id in fixture)
                .map((id) => ({ id: fixture[id], external_ids: { sleeper: id } }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, captured };
}

const FIXTURE: Record<string, string> = {
  "4046": "uuid-josh-allen", // numeric skill player
  BUF: "uuid-bills-def", // non-numeric DEF team code
  "5045": "uuid-harrison-butker", // kicker (numeric)
};

describe("mapSleeperToPlayerIds", () => {
  it("round-trips numeric ids, a DEF team code, and a kicker; drops unknown + hostile", async () => {
    const { client, captured } = makeClient(FIXTURE);
    const map = await mapSleeperToPlayerIds(client, [
      "4046",
      "BUF",
      "5045",
      "9999", // valid shape but no matching player -> absent (partial map)
      "bad id", // hostile (space) -> sanitized out
      "DROP TABLE players", // hostile -> sanitized out
      "0", // empty-slot placeholder -> dropped
    ]);

    expect(map.get("4046")).toBe("uuid-josh-allen");
    expect(map.get("BUF")).toBe("uuid-bills-def");
    expect(map.get("5045")).toBe("uuid-harrison-butker");
    expect(map.has("9999")).toBe(false);
    expect(map.size).toBe(3);

    // The hostile ids never reached the filter string.
    const filter = captured.join("|");
    expect(filter).not.toContain("DROP");
    expect(filter).not.toContain("bad id");
    expect(filter).not.toContain(" ");
    // The sanitized ids did.
    expect(filter).toContain("external_ids->>sleeper.eq.4046");
    expect(filter).toContain("external_ids->>sleeper.eq.BUF");
  });

  it("returns an empty map and issues no query when all ids are invalid", async () => {
    const { client, captured } = makeClient(FIXTURE);
    const map = await mapSleeperToPlayerIds(client, ["0", "bad id", ""]);
    expect(map.size).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it("never throws when a chunk query errors (partial map)", async () => {
    const { client } = makeClient(FIXTURE, { fail: true });
    const map = await mapSleeperToPlayerIds(client, ["4046", "BUF"]);
    expect(map.size).toBe(0);
  });
});
