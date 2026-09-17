/**
 * The Relay feed's URL parameters, parsed one way for the hub and its four
 * filter routes (category, team, player, tag). Each route used to carry its
 * own copy of parsePage, and only the hub read `kind` and `week`, so narrowing
 * a team's reports to one week meant editing the address by hand. One parser,
 * one query builder, so a shared link means the same thing on every route.
 *
 * Pure. Values are bounded here (a week is 1 to 22, a page at most
 * MAX_PAGE, a team code is at most four characters, a player slug at most
 * eighty) so nothing downstream has to trust the address bar. A repeated key
 * (`?team=a&team=b`) arrives from Next as an array; the first value wins, the
 * same convention app/rankings/page.tsx uses, rather than a thrown TypeError
 * from calling a string method on an array.
 */

import { isRelayKind, type RelayKind } from "./types";
import { dateKey, parseDateKey, parseMonthKey } from "./calendar";

type SearchValue = string | string[] | undefined;

export type FeedSearch = {
  page?: SearchValue;
  kind?: SearchValue;
  week?: SearchValue;
  team?: SearchValue;
  player?: SearchValue;
  /** How the hub lays the reports out; see FEED_VIEWS. */
  view?: SearchValue;
  /** One Eastern calendar day, YYYY-MM-DD. */
  date?: SearchValue;
  /** The month the calendar view shows, YYYY-MM. */
  month?: SearchValue;
};

/**
 * The hub's views. `grid` is the default (three cards across on a wide
 * screen, one on a phone); `feed` is one full card per row; `week` groups the
 * season by NFL week with a week rail; `calendar` is a month of days.
 */
export const FEED_VIEWS = ["grid", "feed", "week", "calendar"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];
export const DEFAULT_FEED_VIEW: FeedView = "grid";

export function parseView(raw: SearchValue): FeedView {
  const value = first(raw);
  return value && (FEED_VIEWS as readonly string[]).includes(value) ? (value as FeedView) : DEFAULT_FEED_VIEW;
}

/** A real calendar date from the address as YYYY-MM-DD, or null. */
export function parseDate(raw: SearchValue): string | null {
  const p = parseDateKey(first(raw));
  return p ? dateKey(p.year, p.month, p.day) : null;
}

/** A real month from the address, or null. */
export function parseMonth(raw: SearchValue): { year: number; month: number } | null {
  return parseMonthKey(first(raw));
}

/**
 * Past this page the offset is meaningless: the feed is thirty a page, so
 * page 10,000 is three hundred thousand Relays in, and an unbounded value
 * hands PostgREST an offset like 3e21 and the canonical a URL like
 * `?page=1e+20`.
 */
export const MAX_PAGE = 10_000;

/** The first value of a query key, or undefined. */
export function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePage(raw: SearchValue): number {
  const n = Number.parseInt(first(raw) ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

export function parseWeek(raw: SearchValue): number | null {
  const value = first(raw);
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 && n <= 22 ? n : null;
}

export function parseKind(raw: SearchValue): RelayKind | null {
  const value = first(raw);
  return value && isRelayKind(value) ? value : null;
}

/** The raw team code from the address, uppercased and capped at four characters. */
export function parseTeamCode(raw: SearchValue): string | null {
  const value = first(raw);
  return value ? value.toUpperCase().slice(0, 4) : null;
}

/** The raw player slug from the address, capped at eighty characters. */
export function parsePlayerSlug(raw: SearchValue): string | null {
  const value = first(raw);
  return value ? value.slice(0, 80) : null;
}

type FilterKey = "kind" | "week" | "team" | "player" | "view" | "date" | "month";

export const HUB_KEYS: readonly FilterKey[] = ["view", "kind", "week", "team", "player", "date", "month"];

/**
 * The query string the recognised filters produce ("?kind=injury&week=2"),
 * or "" when none is set. `keys` limits which filters a route carries: a team
 * route carries kind and week but never a second team. The default view is
 * never written, so the bare hub keeps a bare canonical.
 */
export function feedQuery(search: FeedSearch, keys: readonly FilterKey[] = HUB_KEYS): string {
  const params = new URLSearchParams();
  if (keys.includes("view")) {
    const view = parseView(search.view);
    if (view !== DEFAULT_FEED_VIEW) params.set("view", view);
  }
  if (keys.includes("kind")) {
    const kind = parseKind(search.kind);
    if (kind) params.set("kind", kind);
  }
  if (keys.includes("week")) {
    const week = parseWeek(search.week);
    if (week !== null) params.set("week", String(week));
  }
  if (keys.includes("team")) {
    const team = parseTeamCode(search.team);
    if (team) params.set("team", team);
  }
  if (keys.includes("player")) {
    const player = parsePlayerSlug(search.player);
    if (player) params.set("player", player);
  }
  if (keys.includes("date")) {
    const date = parseDate(search.date);
    if (date) params.set("date", date);
  }
  if (keys.includes("month")) {
    const month = parseMonth(search.month);
    if (month) params.set("month", `${month.year}-${String(month.month).padStart(2, "0")}`);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** `base` plus the filter query plus `page=N` when past the first page. */
export function feedPath(base: string, search: FeedSearch, keys?: readonly FilterKey[]): string {
  const query = feedQuery(search, keys);
  const page = parsePage(search.page);
  const pagePart = page > 1 ? `${query ? "&" : "?"}page=${page}` : "";
  return `${base}${query}${pagePart}`;
}
