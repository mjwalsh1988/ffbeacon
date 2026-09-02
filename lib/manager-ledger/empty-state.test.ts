import { describe, it, expect } from "vitest";
import { ledgerEmptyState } from "../league-manager-ledger-data";

describe("ledgerEmptyState", () => {
  it("offers the worked example to a league that has simply not played yet", () => {
    const state = ledgerEmptyState("skipped");
    expect(state.showPreview).toBe(true);
    expect(state.title).toMatch(/yet/i);
  });

  it("offers it to a league whose ledger has not been built for the first time", () => {
    expect(ledgerEmptyState(null).showPreview).toBe(true);
    expect(ledgerEmptyState("pending").showPreview).toBe(true);
  });

  it("NEVER offers it to a league that can never be graded", () => {
    // 'settled' means the league's starting slots have no position eligibility,
    // so no figure will ever appear on this page. A preview is a promise about
    // what a reader is going to see, and this reader is not going to see it.
    const state = ledgerEmptyState("settled");
    expect(state.showPreview).toBe(false);
    expect(state.next).toBeNull();
  });

  it("NEVER offers it after a failed run", () => {
    // A fault to report, not a season to look forward to. A glossy example
    // under an error tells a reader the opposite of what happened.
    expect(ledgerEmptyState("error").showPreview).toBe(false);
  });

  it("gives every state a title and a body, so no branch renders an empty panel", () => {
    for (const status of ["skipped", "settled", "error", "pending", null, undefined]) {
      const state = ledgerEmptyState(status);
      expect(state.title.length).toBeGreaterThan(0);
      expect(state.body.length).toBeGreaterThan(0);
    }
  });
});
