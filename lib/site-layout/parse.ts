/**
 * Reading and validating the stored site layout. Pure and client-safe, so the
 * tests need no database; `settings.ts` does the loading and saving.
 *
 * Two different jobs with two different tempers:
 *
 *   mergeSiteLayout     LENIENT. Whatever is in the row, the site still gets a
 *                       complete layout: unknown tools and tags are dropped,
 *                       missing ones filled from the defaults. A menu has to
 *                       render on every page, including the page after a bad
 *                       save or a tool being removed from the code.
 *
 *   validateSiteLayout  STRICT. The admin save path. The form always sends every
 *                       list in full, so anything short of that is a stale form
 *                       or a hand-made request, and it is refused with a reason
 *                       rather than quietly repaired.
 */

import { z } from "zod";
import type { ToolHref } from "@/lib/tools-catalog";
import {
  CARD_WIDTHS,
  DEFAULT_SITE_LAYOUT,
  HIGHLIGHT_COLORS,
  NAV_SECTION_IDS,
  TOOL_BADGE_KEYS,
  TOOL_HREFS,
  plainCard,
  type CardWidth,
  type HighlightColor,
  type HomepageToolCard,
  type SiteLayoutSettings,
  type ToolBadgeKey,
} from "./default-settings";
import { isPermutationOf, normalizeOrder } from "./order";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOrNull(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Every tool, led by `preferred`, so a tool missing from a default still appears. */
function toolsLedBy(preferred: readonly ToolHref[]): ToolHref[] {
  return normalizeOrder(preferred, TOOL_HREFS);
}

function isOneOf<T extends string | number>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

function mergeCards(raw: unknown): HomepageToolCard[] {
  const defaults = new Map(DEFAULT_SITE_LAYOUT.homepage.cards.map((card) => [card.href, card]));
  const defaultOrder = toolsLedBy(DEFAULT_SITE_LAYOUT.homepage.cards.map((card) => card.href));
  const fallback = (href: ToolHref) => defaults.get(href) ?? plainCard(href);

  if (!Array.isArray(raw)) return defaultOrder.map(fallback);

  const stored = new Map<ToolHref, HomepageToolCard>();
  for (const entry of raw) {
    const card = record(entry);
    const href = card.href;
    if (!isOneOf(TOOL_HREFS, href) || stored.has(href)) continue;
    stored.set(href, {
      href,
      width: isOneOf<CardWidth>(CARD_WIDTHS, card.width) ? card.width : 1,
      badge: isOneOf<ToolBadgeKey>(TOOL_BADGE_KEYS, card.badge) ? card.badge : null,
      highlight: isOneOf<HighlightColor>(HIGHLIGHT_COLORS, card.highlight) ? card.highlight : null,
    });
  }

  // A tool the row has never heard of joins at the end with its default card,
  // so a tool that ships with a "New tool" tag in the defaults keeps it.
  return normalizeOrder([...stored.keys()], defaultOrder).map(
    (href) => stored.get(href) ?? fallback(href),
  );
}

/** A complete layout from whatever is stored. Never throws. */
export function mergeSiteLayout(raw: unknown): SiteLayoutSettings {
  const root = record(raw);
  const menu = record(root.menu);
  const toolsPage = record(root.toolsPage);
  const homepage = record(root.homepage);
  const d = DEFAULT_SITE_LAYOUT;
  return {
    menu: {
      sectionOrder: normalizeOrder(
        arrayOrNull(menu.sectionOrder),
        normalizeOrder(d.menu.sectionOrder, NAV_SECTION_IDS),
      ),
      toolOrder: normalizeOrder(arrayOrNull(menu.toolOrder), toolsLedBy(d.menu.toolOrder)),
    },
    toolsPage: {
      toolOrder: normalizeOrder(
        arrayOrNull(toolsPage.toolOrder),
        toolsLedBy(d.toolsPage.toolOrder),
      ),
    },
    homepage: { cards: mergeCards(homepage.cards) },
  };
}

const toolHref = z.enum(TOOL_HREFS as [ToolHref, ...ToolHref[]]);

// strictObject rather than object: a key the form never sends is refused with
// an error instead of being silently dropped, so a hand-made payload fails
// loudly.
const strictSchema = z.strictObject({
  menu: z.strictObject({
    sectionOrder: z.array(z.enum(NAV_SECTION_IDS)).max(50),
    toolOrder: z.array(toolHref).max(50),
  }),
  toolsPage: z.strictObject({
    toolOrder: z.array(toolHref).max(50),
  }),
  homepage: z.strictObject({
    cards: z
      .array(
        z.strictObject({
          href: toolHref,
          width: z.union([z.literal(1), z.literal(2), z.literal(3)]),
          badge: z.enum(TOOL_BADGE_KEYS as [ToolBadgeKey, ...ToolBadgeKey[]]).nullable(),
          highlight: z.enum(HIGHLIGHT_COLORS).nullable(),
        }),
      )
      .max(50),
  }),
});

/** Where each list lives on the admin page, for an error a person can act on. */
const LIST_NAMES: Record<string, string> = {
  "menu.sectionOrder": "Main menu sections",
  "menu.toolOrder": "Main menu tools",
  "toolsPage.toolOrder": "All tools page",
  "homepage.cards": "Homepage cards",
};

function listName(path: ReadonlyArray<PropertyKey>): string {
  const key = path.slice(0, 2).map(String).join(".");
  return LIST_NAMES[key] ?? (key || "Layout");
}

export type ValidateResult =
  | { ok: true; settings: SiteLayoutSettings }
  | { ok: false; error: string };

/** Validate an untrusted layout. The admin save path's only gate. */
export function validateSiteLayout(raw: unknown): ValidateResult {
  const parsed = strictSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `${listName(issue?.path ?? [])}: ${issue?.message ?? "invalid"}.`,
    };
  }
  const settings = parsed.data as SiteLayoutSettings;

  const checks: Array<[string, readonly string[], readonly string[]]> = [
    ["Main menu sections", settings.menu.sectionOrder, NAV_SECTION_IDS],
    ["Main menu tools", settings.menu.toolOrder, TOOL_HREFS],
    ["All tools page", settings.toolsPage.toolOrder, TOOL_HREFS],
    ["Homepage cards", settings.homepage.cards.map((card) => card.href), TOOL_HREFS],
  ];
  for (const [name, list, known] of checks) {
    if (!isPermutationOf(list, known)) {
      return {
        ok: false,
        error: `${name}: every entry has to appear exactly once. Reload the page and try again.`,
      };
    }
  }
  return { ok: true, settings };
}
