import { describe, expect, it } from "vitest";
import {
  classifyLookupFailure,
  LOOKUP_FAILED_MESSAGE,
  LOOKUP_THROTTLED_MESSAGE,
} from "./lookup-failure";

/**
 * The whole point of this helper is that ONE status is soft. The test says so
 * explicitly rather than only checking the default, because the ten-second
 * cooldown on the leagues route makes 429 a routine answer for a reader who
 * reloads twice, and treating it like a broken handle is the mistake this
 * module exists to prevent.
 */
describe("classifyLookupFailure", () => {
  it("treats 429 as throttled, because the cooldown is not a broken handle", () => {
    expect(classifyLookupFailure(429)).toBe("throttled");
  });

  it("treats 404 as failed, because the saved handle no longer resolves", () => {
    expect(classifyLookupFailure(404)).toBe("failed");
  });

  it("treats 401 as failed", () => {
    expect(classifyLookupFailure(401)).toBe("failed");
  });

  it("treats 500 as failed", () => {
    expect(classifyLookupFailure(500)).toBe("failed");
  });

  it("treats anything else, including a network zero, as failed", () => {
    expect(classifyLookupFailure(0)).toBe("failed");
    expect(classifyLookupFailure(503)).toBe("failed");
  });
});

describe("the two sentences", () => {
  it("keeps them distinct, and only one of them mentions Retry", () => {
    expect(LOOKUP_THROTTLED_MESSAGE).not.toBe(LOOKUP_FAILED_MESSAGE);
    expect(LOOKUP_THROTTLED_MESSAGE).toContain("Retry");
    expect(LOOKUP_FAILED_MESSAGE).not.toContain("Retry");
  });
});
