import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEAGUE_RELAY_SETTINGS,
  liveMessageTypes,
  mergeLeagueRelaySettings,
  validateLeagueRelaySettings,
} from "./settings";

// A real v4 UUID. The schema validates the version and variant nibbles the way
// Postgres' gen_random_uuid() sets them, so a made-up "1111-2222-3333" string
// is rejected as malformed rather than accepted as an id.
const WEBHOOK = "11111111-2222-4333-8444-555555555555";

/** A valid document with one message type pointed at a channel. */
function withTrade(over: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_LEAGUE_RELAY_SETTINGS,
    enabled: true,
    channels: {
      ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels,
      trade: {
        ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels.trade,
        enabled: true,
        webhook_id: WEBHOOK,
      },
    },
    ...over,
  };
}

describe("defaults", () => {
  it("ships with everything off, because this posts into a room other people read", () => {
    expect(DEFAULT_LEAGUE_RELAY_SETTINGS.enabled).toBe(false);
    for (const channel of Object.values(DEFAULT_LEAGUE_RELAY_SETTINGS.channels)) {
      expect(channel.enabled).toBe(false);
      expect(channel.webhook_id).toBeNull();
    }
  });

  it("pings nobody until somebody says so", () => {
    for (const channel of Object.values(DEFAULT_LEAGUE_RELAY_SETTINGS.channels)) {
      expect(channel.mention_role_ids).toEqual([]);
    }
  });
});

describe("validateLeagueRelaySettings", () => {
  it("accepts a complete document", () => {
    expect(validateLeagueRelaySettings(withTrade()).ok).toBe(true);
  });

  it("refuses a message type switched on with nowhere to send it", () => {
    // Saving this would look like it was working and would post nothing, which
    // an admin cannot tell apart from a Discord outage.
    const result = validateLeagueRelaySettings({
      ...DEFAULT_LEAGUE_RELAY_SETTINGS,
      enabled: true,
      channels: {
        ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels,
        trade: { ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels.trade, enabled: true },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("channels.trade.webhook_id");
  });

  it("refuses a recap window that ends before it starts", () => {
    const result = validateLeagueRelaySettings(
      withTrade({
        channels: {
          ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels,
          matchup_recap: {
            ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels.matchup_recap,
            enabled: true,
            webhook_id: WEBHOOK,
          },
        },
        matchups: {
          ...DEFAULT_LEAGUE_RELAY_SETTINGS.matchups,
          recap_start_hour: 16,
          recap_end_hour: 11,
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("recap_end_hour");
  });

  it("refuses previews with neither game selected", () => {
    const result = validateLeagueRelaySettings(
      withTrade({
        channels: {
          ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels,
          matchup_preview: {
            ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels.matchup_preview,
            enabled: true,
            webhook_id: WEBHOOK,
          },
        },
        matchups: {
          ...DEFAULT_LEAGUE_RELAY_SETTINGS.matchups,
          preview_headline: false,
          preview_undercard: false,
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a role id that is not a snowflake", () => {
    // This value goes straight into allowed_mentions, the one list that decides
    // who Discord is allowed to notify.
    const result = validateLeagueRelaySettings(
      withTrade({
        channels: {
          ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels,
          trade: {
            ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels.trade,
            enabled: true,
            webhook_id: WEBHOOK,
            mention_role_ids: ["@everyone"],
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("treats an empty webhook string as no webhook rather than as an id", () => {
    const result = validateLeagueRelaySettings({
      ...DEFAULT_LEAGUE_RELAY_SETTINGS,
      channels: {
        ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels,
        trade: { ...DEFAULT_LEAGUE_RELAY_SETTINGS.channels.trade, webhook_id: "" },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.settings.channels.trade.webhook_id).toBeNull();
  });

  it("rejects a snark value outside the dial", () => {
    expect(validateLeagueRelaySettings(withTrade({ voice: { snark: 5 } })).ok).toBe(false);
  });
});

describe("mergeLeagueRelaySettings", () => {
  it("fills an older document out rather than rejecting it", () => {
    const merged = mergeLeagueRelaySettings({ enabled: true });
    expect(merged.enabled).toBe(true);
    expect(merged.matchups.recap_start_hour).toBe(
      DEFAULT_LEAGUE_RELAY_SETTINGS.matchups.recap_start_hour,
    );
  });

  it("falls all the way back on a corrupt row, so the cron does not throw", () => {
    expect(mergeLeagueRelaySettings({ enabled: "yes" })).toEqual(DEFAULT_LEAGUE_RELAY_SETTINGS);
    expect(mergeLeagueRelaySettings(null)).toEqual(DEFAULT_LEAGUE_RELAY_SETTINGS);
  });
});

describe("liveMessageTypes", () => {
  it("is empty while the master switch is off, whatever the channels say", () => {
    const settings = mergeLeagueRelaySettings(withTrade({ enabled: false }));
    expect(liveMessageTypes(settings)).toEqual([]);
  });

  it("lists only types that are on AND have somewhere to go", () => {
    const settings = mergeLeagueRelaySettings(withTrade());
    expect(liveMessageTypes(settings)).toEqual(["trade"]);
  });
});
