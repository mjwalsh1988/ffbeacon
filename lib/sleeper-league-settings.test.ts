/**
 * The jsonb accessor, and the promise migration 0268 makes about it.
 *
 * The case that matters most is the first one: rows written before 0268 hold
 * only `username`, and every one of them has to keep parsing into exactly the
 * object it parsed into yesterday. The identity keys are additive, and a
 * missing key is absent rather than null, because `lib/sleeper-handle/resolve.ts`
 * reads a null `sleeper_user_id` as "resolve this once and write it back".
 */

import { describe, expect, it } from "vitest";
import {
  mergeSleeperLeagueSettings,
  parseSleeperLeagueSettings,
} from "./sleeper-league-settings";

describe("parseSleeperLeagueSettings", () => {
  it("parses a legacy row with only a username exactly as before", () => {
    expect(parseSleeperLeagueSettings({ username: "beacon" })).toEqual({
      username: "beacon",
    });
  });

  it("round-trips every identity key", () => {
    const stored = {
      username: "Beacon",
      sleeper_user_id: "123456789",
      sleeper_display_name: "Beacon Mike",
      sleeper_avatar: "ab12cd34",
      handle_verified_at: "2026-09-05T12:00:00.000Z",
    };
    expect(parseSleeperLeagueSettings(stored)).toEqual(stored);
  });

  it("keeps an explicit null as a clear", () => {
    const parsed = parseSleeperLeagueSettings({
      username: null,
      sleeper_user_id: null,
      sleeper_avatar: null,
    });
    expect(parsed.username).toBeNull();
    expect(parsed.sleeper_user_id).toBeNull();
    expect(parsed.sleeper_avatar).toBeNull();
  });

  it("drops a non-string identity value rather than passing it through", () => {
    const parsed = parseSleeperLeagueSettings({
      username: "beacon",
      sleeper_user_id: 123456789,
      sleeper_display_name: { nested: true },
      sleeper_avatar: ["a"],
      handle_verified_at: "",
    });
    expect(parsed).toEqual({ username: "beacon" });
  });

  it("still parses the league keys 0028 defined", () => {
    const parsed = parseSleeperLeagueSettings({
      username: "beacon",
      featured_league_id: "111",
      shown_league_ids: ["111", "", 7, "222"],
      signal_league_ids: ["111", "111", "222"],
    });
    expect(parsed.featured_league_id).toBe("111");
    expect(parsed.shown_league_ids).toEqual(["111", "222"]);
    expect(parsed.signal_league_ids).toEqual(["111", "222"]);
  });

  it("treats a non-object as empty", () => {
    expect(parseSleeperLeagueSettings(null)).toEqual({});
    expect(parseSleeperLeagueSettings("beacon")).toEqual({});
    expect(parseSleeperLeagueSettings(["beacon"])).toEqual({});
  });
});

describe("mergeSleeperLeagueSettings", () => {
  it("leaves sibling keys alone while writing the identity", () => {
    const merged = mergeSleeperLeagueSettings(
      { username: "old", signal_league_ids: ["111"] },
      { username: "new", sleeper_user_id: "9", sleeper_avatar: null },
    );
    expect(merged).toEqual({
      username: "new",
      sleeper_user_id: "9",
      sleeper_avatar: null,
      signal_league_ids: ["111"],
    });
  });

  it("ignores an undefined patch key", () => {
    const merged = mergeSleeperLeagueSettings(
      { username: "old", sleeper_user_id: "9" },
      { username: undefined },
    );
    expect(merged).toEqual({ username: "old", sleeper_user_id: "9" });
  });
});
