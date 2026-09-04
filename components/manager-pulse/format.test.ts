import { describe, it, expect } from "vitest";
import {
  formatPercent,
  formatRate,
  formatCount,
  formatRecord,
  formatSigned,
  formatSample,
  formatRounds,
  formatSeconds,
} from "./format";

describe("formatPercent", () => {
  it("renders a share as a whole-number percent by default", () => {
    expect(formatPercent(0.62)).toBe("62%");
  });

  it("respects a digits override", () => {
    expect(formatPercent(0.623, 1)).toBe("62.3%");
  });

  it("renders zero as 0%, not as an absence", () => {
    expect(formatPercent(0)).toBe("0%");
  });

  it("never says 0% for a null value", () => {
    expect(formatPercent(null)).toBe("--");
  });
});

describe("formatRate", () => {
  it("renders a decimal rate to one place", () => {
    expect(formatRate(2.44)).toBe("2.4");
  });

  it("renders null as a dash", () => {
    expect(formatRate(null)).toBe("--");
  });
});

describe("formatCount", () => {
  it("renders a whole number", () => {
    expect(formatCount(14)).toBe("14");
  });

  it("rounds a fractional count rather than truncating silently", () => {
    expect(formatCount(13.6)).toBe("14");
  });

  it("renders zero as 0, not as an absence", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("renders null as a dash", () => {
    expect(formatCount(null)).toBe("--");
  });
});

describe("formatRecord", () => {
  it("renders a record with no ties without a trailing zero", () => {
    expect(formatRecord({ wins: 34, losses: 19, ties: 0 })).toBe("34-19");
  });

  it("renders a record with ties", () => {
    expect(formatRecord({ wins: 34, losses: 19, ties: 1 })).toBe("34-19-1");
  });

  it("renders null as a dash", () => {
    expect(formatRecord(null)).toBe("--");
  });
});

describe("formatSigned", () => {
  it("signs a positive value with a word unit", () => {
    expect(formatSigned(0.8, "rounds")).toBe("+0.8 rounds");
  });

  it("signs a negative value with a percent unit and no space", () => {
    expect(formatSigned(-8, "%")).toBe("-8.0%");
  });

  it("renders no unit when none is given", () => {
    expect(formatSigned(1.5)).toBe("+1.5");
  });

  it("renders zero with no sign", () => {
    expect(formatSigned(0, "rounds")).toBe("0.0 rounds");
  });

  it("renders null as a dash", () => {
    expect(formatSigned(null, "rounds")).toBe("--");
  });
});

describe("formatSample", () => {
  it("pluralizes the noun for a count above one", () => {
    expect(formatSample(14, "trade")).toBe("over 14 trades");
  });

  it("keeps the noun singular for exactly one", () => {
    expect(formatSample(1, "trade")).toBe("over 1 trade");
  });

  it("renders an empty string for zero, since there is no sample to cite", () => {
    expect(formatSample(0, "trade")).toBe("");
  });

  it("renders an empty string for null", () => {
    expect(formatSample(null, "trade")).toBe("");
  });
});

describe("formatRounds", () => {
  it("renders a rounds figure to one decimal", () => {
    expect(formatRounds(0.75)).toBe("0.8 rounds");
  });

  it("uses the singular noun for exactly one round", () => {
    expect(formatRounds(1)).toBe("1.0 round");
  });

  it("renders null as a dash", () => {
    expect(formatRounds(null)).toBe("--");
  });
});

describe("formatSeconds", () => {
  it("renders a whole number of seconds", () => {
    expect(formatSeconds(42.4)).toBe("42 seconds");
  });

  it("uses the singular noun for exactly one second", () => {
    expect(formatSeconds(1)).toBe("1 second");
  });

  it("renders null as a dash", () => {
    expect(formatSeconds(null)).toBe("--");
  });
});
