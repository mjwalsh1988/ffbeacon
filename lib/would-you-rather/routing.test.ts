import { describe, expect, it } from "vitest";
import { DEFAULT_WOULD_YOU_RATHER_SETTINGS } from "./default-settings";
import {
  categoryForLeagueMetadata,
  describeRouting,
  hasAnyWebhook,
  postableCategories,
  unroutedCategories,
  webhookForCategory,
} from "./routing";
import type { WouldYouRatherSettings } from "./default-settings";

const DEFAULT_ROUTES = DEFAULT_WOULD_YOU_RATHER_SETTINGS.discord.routes;

const FALLBACK = "11111111-1111-4111-8111-111111111111";
const DYNASTY = "22222222-2222-4222-8222-222222222222";
const REDRAFT = "33333333-3333-4333-8333-333333333333";

function settings(discord: Partial<WouldYouRatherSettings["discord"]>): WouldYouRatherSettings {
  return {
    ...DEFAULT_WOULD_YOU_RATHER_SETTINGS,
    discord: { ...DEFAULT_WOULD_YOU_RATHER_SETTINGS.discord, ...discord },
  };
}

describe("categoryForLeagueMetadata", () => {
  it("reads dynasty off Sleeper's own league type", () => {
    expect(categoryForLeagueMetadata({ settings: { type: 2 } })).toBe("dynasty");
  });

  it("files keeper and guillotine leagues as redraft, which is how they price", () => {
    expect(categoryForLeagueMetadata({ settings: { type: 1 } })).toBe("redraft");
    expect(categoryForLeagueMetadata({ settings: { type: 3 } })).toBe("redraft");
    expect(categoryForLeagueMetadata({ settings: { type: 0 } })).toBe("redraft");
  });

  it("splits best ball by whether it carries rosters forward", () => {
    expect(categoryForLeagueMetadata({ settings: { type: 2, best_ball: 1 } })).toBe(
      "best-ball-dynasty",
    );
    expect(categoryForLeagueMetadata({ settings: { type: 0, best_ball: 1 } })).toBe(
      "best-ball-redraft",
    );
  });

  it("refuses to guess when the raw league object is missing", () => {
    expect(categoryForLeagueMetadata(null)).toBeNull();
    expect(categoryForLeagueMetadata({})).toBeNull();
    expect(categoryForLeagueMetadata("not an object")).toBeNull();
  });
});

describe("webhookForCategory", () => {
  it("prefers the type's own channel over the fallback", () => {
    const s = settings({ webhook_id: FALLBACK, routes: { ...DEFAULT_ROUTES, redraft: REDRAFT } });
    expect(webhookForCategory(s, "redraft")).toBe(REDRAFT);
    expect(webhookForCategory(s, "dynasty")).toBe(FALLBACK);
  });

  it("sends a trade whose league type could not be derived to the fallback", () => {
    const s = settings({ webhook_id: FALLBACK, routes: { ...DEFAULT_ROUTES, redraft: REDRAFT } });
    expect(webhookForCategory(s, null)).toBe(FALLBACK);
  });

  it("has nowhere to send a type with no channel and no fallback", () => {
    const s = settings({ webhook_id: null, routes: { ...DEFAULT_ROUTES, redraft: REDRAFT } });
    expect(webhookForCategory(s, "dynasty")).toBeNull();
    expect(webhookForCategory(s, null)).toBeNull();
    expect(webhookForCategory(s, "redraft")).toBe(REDRAFT);
  });
});

describe("postableCategories", () => {
  it("does not restrict the pick at all while a fallback exists", () => {
    expect(postableCategories(settings({ webhook_id: FALLBACK }))).toBeNull();
    expect(
      postableCategories(
        settings({ webhook_id: FALLBACK, routes: { ...DEFAULT_ROUTES, dynasty: DYNASTY } }),
      ),
    ).toBeNull();
  });

  it("restricts to the types with a channel when there is no fallback", () => {
    expect(
      postableCategories(
        settings({
          webhook_id: null,
          routes: { ...DEFAULT_ROUTES, dynasty: DYNASTY, redraft: REDRAFT },
        }),
      ),
    ).toEqual(["dynasty", "redraft"]);
  });

  it("restricts to nothing when no channel is set anywhere", () => {
    expect(postableCategories(settings({ webhook_id: null }))).toEqual([]);
  });
});

describe("hasAnyWebhook", () => {
  it("counts the fallback and each per-type channel alike", () => {
    expect(hasAnyWebhook(settings({ webhook_id: FALLBACK }))).toBe(true);
    expect(
      hasAnyWebhook(
        settings({ webhook_id: null, routes: { ...DEFAULT_ROUTES, dynasty: DYNASTY } }),
      ),
    ).toBe(true);
    expect(hasAnyWebhook(settings({ webhook_id: null }))).toBe(false);
  });
});

describe("unroutedCategories", () => {
  it("finds nothing unrouted while a fallback exists", () => {
    expect(unroutedCategories(settings({ webhook_id: FALLBACK }))).toEqual([]);
  });

  it("names the types left without a channel", () => {
    expect(
      unroutedCategories(
        settings({ webhook_id: null, routes: { ...DEFAULT_ROUTES, dynasty: DYNASTY } }),
      ),
    ).toEqual(["redraft", "best-ball-dynasty", "best-ball-redraft"]);
  });
});

describe("describeRouting", () => {
  it("says one trade per scheduled time, routed by that trade's type", () => {
    expect(describeRouting(settings({ webhook_id: FALLBACK }))).toBe(
      "Every scheduled time posts one trade, to whichever channel matches that trade's league type.",
    );
    // Splitting a type out does not turn one post into two.
    expect(
      describeRouting(
        settings({ webhook_id: FALLBACK, routes: { ...DEFAULT_ROUTES, dynasty: DYNASTY } }),
      ),
    ).toBe(
      "Every scheduled time posts one trade, to whichever channel matches that trade's league type.",
    );
  });

  it("names the league types that will not be picked at all", () => {
    expect(
      describeRouting(
        settings({ webhook_id: null, routes: { ...DEFAULT_ROUTES, dynasty: DYNASTY } }),
      ),
    ).toBe(
      "Every scheduled time posts one trade, to whichever channel matches that trade's league type. Redraft, Best Ball Dynasty and Best Ball Redraft have no webhook, so those trades are not picked at all.",
    );
  });

  it("says so plainly when nothing is configured", () => {
    expect(describeRouting(settings({ webhook_id: null }))).toBe(
      "No league type has a webhook, so nothing will post.",
    );
  });
});
