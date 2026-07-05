import { describe, it, expect } from "vitest";
import { validateFormatReportInput } from "./report-validate";

const base = {
  reporterName: "Jane Manager",
  reporterEmail: "jane@example.com",
  sleeperUsername: "janem",
  leagueName: "The Big League",
  leagueId: "1234567890",
  draftId: "9876543210",
  season: "2026",
  totalRosters: 12,
  draftStatus: "drafting",
  assignedFormatLabel: "Redraft PPR",
  assignedFormatSlug: "redraft-ppr-std",
  derivedFormatLabel: "Dynasty PPR Superflex",
  isClosestMatch: false,
  details: "This is dynasty superflex, not redraft.",
};

describe("validateFormatReportInput", () => {
  it("accepts a well-formed report", () => {
    const r = validateFormatReportInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reporterEmail).toBe("jane@example.com");
      expect(r.value.totalRosters).toBe(12);
      expect(r.value.details).toBe("This is dynasty superflex, not redraft.");
    }
  });

  it("requires a name", () => {
    const r = validateFormatReportInput({ ...base, reporterName: "   " });
    expect(r.ok).toBe(false);
  });

  it("requires a valid email", () => {
    expect(validateFormatReportInput({ ...base, reporterEmail: "" }).ok).toBe(false);
    expect(validateFormatReportInput({ ...base, reporterEmail: "not-an-email" }).ok).toBe(false);
    expect(validateFormatReportInput({ ...base, reporterEmail: "a@b.co" }).ok).toBe(true);
  });

  it("rejects non-numeric Sleeper ids and bad seasons", () => {
    expect(validateFormatReportInput({ ...base, leagueId: "abc" }).ok).toBe(false);
    expect(validateFormatReportInput({ ...base, draftId: "12-34" }).ok).toBe(false);
    expect(validateFormatReportInput({ ...base, season: "26" }).ok).toBe(false);
  });

  it("treats an empty optional note as null and clamps roster counts", () => {
    const r = validateFormatReportInput({ ...base, details: "  ", totalRosters: 999 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.details).toBeNull();
      expect(r.value.totalRosters).toBe(64);
    }
  });

  it("defaults missing context labels rather than failing", () => {
    const r = validateFormatReportInput({
      ...base,
      sleeperUsername: "",
      leagueName: "",
      totalRosters: "nope",
      assignedFormatSlug: "",
      derivedFormatLabel: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sleeperUsername).toBe("Unknown");
      expect(r.value.leagueName).toBe("Unknown league");
      expect(r.value.totalRosters).toBeNull();
      expect(r.value.assignedFormatSlug).toBeNull();
      expect(r.value.derivedFormatLabel).toBeNull();
    }
  });
});
