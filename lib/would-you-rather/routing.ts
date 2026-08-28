/**
 * Where a Would You Rather poll goes.
 *
 * One Discord channel for every trade was fine while the pool was one league
 * type deep. It is not fine once a server keeps a dynasty room, a redraft room
 * and a best ball room: a redraft manager reading a dynasty trade has no way to
 * price it, and says so. So each league type gets its own webhook.
 *
 * THE TRADE IS CHOSEN FIRST AND THE CHANNEL FOLLOWS FROM IT. A scheduled hour
 * picks one trade on its own merits (recent, not posted lately, lightly voted),
 * reads that trade's league type, and posts to whichever channel that type is
 * pointed at. The channels are not a quota: nothing here goes looking for a
 * dynasty trade because the dynasty room is due one. A week where the pool
 * happens to be all dynasty is a week of posts in the dynasty room, which is an
 * honest reflection of what the pool held.
 *
 * THE CATEGORIES ARE THE SITE'S CATEGORIES. `lib/league-category.ts` already
 * classifies a Sleeper league into dynasty, redraft, best ball dynasty and best
 * ball redraft, and the league-pulse results list groups by exactly those four.
 * This reuses that function rather than inventing a second rule, so a league
 * filed under Best Ball Dynasty on the entry list posts to the best ball
 * dynasty channel. Keeper and chopped leagues fall into redraft, which is how
 * they play and how they price.
 *
 * A CATEGORY WITH NO WEBHOOK ANYWHERE IS NOT POSTED. Not to a default channel,
 * not to whichever one happens to be first. Such a trade is left out of the
 * pick entirely rather than chosen and then dropped, so an unroutable league
 * type costs silence in its own room and never costs a scheduled hour.
 */

import type { SleeperLeague } from "@/lib/sleeper";
import { categorizeLeague, type LeagueCategoryKey } from "@/lib/league-category";
import type { WouldYouRatherSettings } from "./default-settings";

export type { LeagueCategoryKey };

/** The four buckets, in the order the admin form and the run log list them. */
export const WYR_ROUTE_CATEGORIES: readonly LeagueCategoryKey[] = [
  "dynasty",
  "redraft",
  "best-ball-dynasty",
  "best-ball-redraft",
] as const;

/** Plain names for the admin form, the run log and the poll table. */
export const WYR_CATEGORY_LABEL: Record<LeagueCategoryKey, string> = {
  dynasty: "Dynasty",
  redraft: "Redraft",
  "best-ball-dynasty": "Best Ball Dynasty",
  "best-ball-redraft": "Best Ball Redraft",
};

/** What each admin choice actually covers, said out loud on the form. */
export const WYR_CATEGORY_HINT: Record<LeagueCategoryKey, string> = {
  dynasty: "Sleeper dynasty leagues, the ones that carry rosters forward.",
  redraft:
    "One-year leagues, plus keeper and guillotine leagues, which price the same way.",
  "best-ball-dynasty": "Best ball rooms that carry rosters forward.",
  "best-ball-redraft": "One-year best ball rooms.",
};

/**
 * The bucket a stored league row belongs to.
 *
 * Reads `leagues.metadata`, which holds the Sleeper league object verbatim.
 * Returns null when that object is missing or has no settings, because a pool
 * row whose league has not finished syncing has no honest answer, and guessing
 * would put a redraft trade in the dynasty channel.
 */
export function categoryForLeagueMetadata(metadata: unknown): LeagueCategoryKey | null {
  if (!metadata || typeof metadata !== "object") return null;
  const league = metadata as SleeperLeague;
  if (!league.settings || typeof league.settings !== "object") return null;
  return categorizeLeague(league);
}

/**
 * Which webhook a trade of this league type posts through: the type's own
 * channel if it has one, otherwise the fallback, otherwise nothing.
 *
 * A null category is a trade whose league type could not be derived. It has no
 * channel of its own by definition, so it goes to the fallback or nowhere.
 */
export function webhookForCategory(
  settings: WouldYouRatherSettings,
  category: LeagueCategoryKey | null,
): string | null {
  const routes = settings.discord.routes ?? {};
  const specific = category ? routes[category] : null;
  return specific ?? settings.discord.webhook_id ?? null;
}

/** Whether any channel is configured at all. The gate on turning posting on. */
export function hasAnyWebhook(settings: WouldYouRatherSettings): boolean {
  if (settings.discord.webhook_id) return true;
  const routes = settings.discord.routes ?? {};
  return WYR_ROUTE_CATEGORIES.some((c) => routes[c]);
}

/**
 * Which league types the poster may pick from, or null for "no restriction".
 *
 * Null whenever the fallback webhook is set, because every type then has
 * somewhere to go and filtering would only cost query work. Without a fallback
 * it is the types that have a channel of their own, which also excludes trades
 * whose league type could not be derived: those have no channel either, and a
 * `league_category in (...)` filter drops a null row on its own.
 */
export function postableCategories(
  settings: WouldYouRatherSettings,
): LeagueCategoryKey[] | null {
  if (settings.discord.webhook_id) return null;
  const routes = settings.discord.routes ?? {};
  return WYR_ROUTE_CATEGORIES.filter((c) => routes[c]);
}

/** The league types that would not be posted anywhere as things stand. */
export function unroutedCategories(
  settings: WouldYouRatherSettings,
): LeagueCategoryKey[] {
  return WYR_ROUTE_CATEGORIES.filter((c) => !webhookForCategory(settings, c));
}

/** "A, B and C" without an Oxford comma and without a stray "and" on one item. */
function joinLabels(labels: string[]): string {
  if (labels.length === 0) return "nothing";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** What the current configuration will actually do, in one sentence or two. */
export function describeRouting(settings: WouldYouRatherSettings): string {
  if (!hasAnyWebhook(settings)) {
    return "No league type has a webhook, so nothing will post.";
  }
  const head =
    "Every scheduled time posts one trade, to whichever channel matches that trade's league type.";
  const unrouted = unroutedCategories(settings);
  if (unrouted.length === 0) return head;
  return `${head} ${joinLabels(unrouted.map((c) => WYR_CATEGORY_LABEL[c]))} ${
    unrouted.length === 1 ? "has" : "have"
  } no webhook, so those trades are not picked at all.`;
}
