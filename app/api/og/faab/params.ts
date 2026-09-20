/**
 * Every query parameter the FAAB share card accepts, and the one function that
 * decides whether a request is worth any work at all.
 *
 * PURE, AND IN ITS OWN MODULE ON PURPOSE. Section 7.15 of
 * docs/faab/faab-calculator-overhaul-plan.md requires the parameters to be
 * validated BEFORE the rate-limit slot is claimed, which means the validator
 * runs on every request including the garbage ones. Keeping it here, importing
 * nothing, is what lets route.test.ts cover it without pulling in next/og, the
 * font reader (which opens files at import time) or a Supabase client. It is
 * the same split app/api/og/start-sit/card-layout.ts makes for the same reason.
 *
 * NOTHING HERE IS CLAMPED. An out-of-range figure is REFUSED rather than
 * squashed into range: the card is a picture of a specific reader's result, and
 * a budget of 500000 silently redrawn as 100000 would be a confident, branded,
 * wrong number with nothing on the image to say it was altered.
 */

/** Sleeper player ids, per the plan's `^[0-9A-Za-z_-]{1,32}$`. */
const PLAYER_ID_PATTERN = /^[0-9A-Za-z_-]{1,32}$/;

/** Digits only: no sign, no decimal point, no exponent, no whitespace. */
const INTEGER_PATTERN = /^[0-9]+$/;

/** The dollar (or budget-share) figures. */
const MAX_MONEY = 100000;

/** The two league kinds the calculator prices. */
export const FAAB_OG_KINDS = ["standard", "chopped"] as const;
export type FaabOgKind = (typeof FAAB_OG_KINDS)[number];

export type FaabOgParams = {
  /** The Sleeper player id the card is about. */
  playerId: string;
  /** What to bid. */
  bid: number;
  /** The figure above which the reader should walk away. */
  walk: number;
  /** The league's full FAAB budget. */
  budget: number;
  /** Chance to win the claim, as a whole percent. */
  win: number;
  /** Whether this is a chopped or guillotine league. */
  kind: FaabOgKind;
};

export type FaabOgParamResult =
  { ok: true; params: FaabOgParams } | { ok: false; reason: string };

/**
 * One integer parameter, or null.
 *
 * `Number("")` is 0 and `Number(" 12 ")` is 12, so the string is pattern
 * checked before it is ever handed to Number. Without that, a missing
 * parameter reads as a perfectly valid zero bid.
 */
function readInteger(raw: string | null, max: number): number | null {
  if (raw === null) return null;
  if (!INTEGER_PATTERN.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

function isKind(raw: string | null): raw is FaabOgKind {
  return raw !== null && (FAAB_OG_KINDS as readonly string[]).includes(raw);
}

/**
 * Validates the whole query string, naming the first thing wrong with it.
 *
 * The reason is for the server log and the plain-text 400 body, not for a
 * reader: this endpoint is only ever reached by a crawler fetching an
 * og:image URL our own page wrote, so a malformed request is either a stale
 * link or someone poking at it.
 */
export function parseFaabOgParams(
  searchParams: URLSearchParams,
): FaabOgParamResult {
  const playerId = searchParams.get("p");
  if (playerId === null || !PLAYER_ID_PATTERN.test(playerId)) {
    return { ok: false, reason: "Invalid player id" };
  }

  const bid = readInteger(searchParams.get("bid"), MAX_MONEY);
  if (bid === null) return { ok: false, reason: "Invalid bid" };

  const walk = readInteger(searchParams.get("walk"), MAX_MONEY);
  if (walk === null) return { ok: false, reason: "Invalid walk away figure" };

  const budget = readInteger(searchParams.get("budget"), MAX_MONEY);
  if (budget === null) return { ok: false, reason: "Invalid budget" };

  const win = readInteger(searchParams.get("win"), 100);
  if (win === null) return { ok: false, reason: "Invalid win chance" };

  const kindRaw = searchParams.get("k");
  if (!isKind(kindRaw)) return { ok: false, reason: "Invalid league kind" };

  return {
    ok: true,
    params: { playerId, bid, walk, budget, win, kind: kindRaw },
  };
}
