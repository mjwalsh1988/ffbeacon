import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildTradeReviewContext } from "./context";

const SHARE_ID = "0b4f2a6e-5c1d-4e8a-9f3b-2d7c8e1a4b5f";

const PAYLOAD = {
  featureLabel: "Signal Check",
  resultLabel: "Beacon Verdict",
  verdictLabel: "Side A wins",
  winnerSide: "a",
  marginPct: 12,
  formatDisplay: "Dynasty Superflex",
  tradeShapeLabel: null,
  confidenceLabel: null,
  explanation: "",
  adjustmentLabel: null,
  sides: [
    { side: "a", teamLabel: null, assets: [{ name: "Josh Allen", detail: null, kind: "player", sleeperId: "1", round: null }], total: null, adjustment: null, adjustmentPct: null },
    { side: "b", teamLabel: null, assets: [{ name: "Bijan Robinson", detail: null, kind: "player", sleeperId: "2", round: null }], total: null, adjustment: null, adjustmentPct: null },
  ],
  valueSnapshotLabel: null,
  createdAtIso: "2026-10-31T12:00:00Z",
};

/** A client whose one query answers with the given row. Records what was selected. */
function clientWith(row: Record<string, unknown> | null) {
  const seen: { table?: string; columns?: string; filter?: [string, string] } = {};
  const client = {
    from(table: string) {
      seen.table = table;
      return {
        select(columns: string) {
          seen.columns = columns;
          return {
            eq(column: string, value: string) {
              seen.filter = [column, value];
              return { maybeSingle: async () => ({ data: row, error: null }) };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, seen };
}

const PRIVATE_ROW = {
  id: "analysis-1",
  public_share_id: SHARE_ID,
  public_payload: PAYLOAD,
  is_public: false,
  user_id: "owner",
  format_slug: "dynasty-ppr-sflex",
};

describe("buildTradeReviewContext", () => {
  it("refuses a share id that is not a uuid without touching the database", async () => {
    const { client, seen } = clientWith(PRIVATE_ROW);
    expect(await buildTradeReviewContext(client, "abc", "owner")).toBeNull();
    expect(seen.table).toBeUndefined();
  });

  it("reads only the public columns of the saved row, by share id", async () => {
    const { client, seen } = clientWith(PRIVATE_ROW);
    await buildTradeReviewContext(client, SHARE_ID, "owner");
    expect(seen.table).toBe("signal_check_analyses");
    expect(seen.filter).toEqual(["public_share_id", SHARE_ID]);
    for (const column of ["sleeper_context", "raw_values", "adjusted_values", "rule_trace"]) {
      expect(seen.columns).not.toContain(column);
    }
  });

  it("gives a private row to its owner and to nobody else", async () => {
    const owner = await buildTradeReviewContext(clientWith(PRIVATE_ROW).client, SHARE_ID, "owner");
    expect(owner?.kind).toBe("trade-review");
    expect(owner?.isPublic).toBe(false);
    expect(owner?.links.share).toBeNull();
    expect(await buildTradeReviewContext(clientWith(PRIVATE_ROW).client, SHARE_ID, "stranger")).toBeNull();
    expect(await buildTradeReviewContext(clientWith(PRIVATE_ROW).client, SHARE_ID, null)).toBeNull();
    expect(
      await buildTradeReviewContext(clientWith({ ...PRIVATE_ROW, user_id: null }).client, SHARE_ID, "anyone"),
    ).toBeNull();
  });

  it("gives a public row to anyone holding the link, with the share page linked", async () => {
    const ctx = await buildTradeReviewContext(
      clientWith({ ...PRIVATE_ROW, is_public: true }).client,
      SHARE_ID,
      "stranger",
    );
    expect(ctx?.links.share).toBe(`/tools/trade-calculator/v/${SHARE_ID}`);
    expect(ctx?.summary).toBe("Josh Allen for Bijan Robinson");
    expect(ctx?.analysisId).toBe("analysis-1");
    expect(ctx?.formatSlug).toBe("dynasty-ppr-sflex");
    expect(JSON.stringify(ctx)).not.toContain("owner");
  });

  it("is null for a missing row or one with no payload", async () => {
    expect(await buildTradeReviewContext(clientWith(null).client, SHARE_ID, "owner")).toBeNull();
    expect(
      await buildTradeReviewContext(clientWith({ ...PRIVATE_ROW, public_payload: null }).client, SHARE_ID, "owner"),
    ).toBeNull();
  });
});
