/**
 * The /rankings hub, and the one flag that shows it to a reader with a saved format.
 *
 * Owner decision, 2026-09-11 (docs/seo-audit/seo-audit-and-plan.md, finding D04):
 * /rankings is a hub for choosing a format, UNLESS the reader already has one saved
 * (in their account or in the format cookie), in which case it lands them straight on
 * that format's board. Search engines and first-time visitors carry no saved format,
 * so they always get the hub.
 *
 * A reader with a saved format still needs a way to reach the hub to look at the
 * other formats, and the breadcrumb's "Rankings" crumb on a format page must not
 * bounce them back to the page they are already on. Links that mean "show me every
 * format" carry this flag. The hub's canonical is the bare /rankings, so the flagged
 * URL never competes with it.
 */

export const RANKINGS_HUB_VIEW_PARAM = "view";
export const RANKINGS_HUB_VIEW_VALUE = "formats";
export const RANKINGS_HUB_HREF = `/rankings?${RANKINGS_HUB_VIEW_PARAM}=${RANKINGS_HUB_VIEW_VALUE}`;

type QueryValue = string | string[] | undefined;

function first(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** True when the request asked for the hub itself rather than the saved board. */
export function wantsRankingsHub(view: QueryValue): boolean {
  return first(view) === RANKINGS_HUB_VIEW_VALUE;
}

/**
 * The query string carried from the hub onto a format board: the source and the
 * position filter, which are reader choices the board honours, and nothing else.
 * Values are encoded by URLSearchParams, so nothing a visitor types can break out of
 * the query string; the board validates both values itself.
 */
export function rankingsBoardQuery(params: {
  source?: QueryValue;
  position?: QueryValue;
}): string {
  const carry = new URLSearchParams();
  const source = first(params.source);
  const position = first(params.position);
  if (source) carry.set("source", source);
  if (position) carry.set("position", position);
  const query = carry.toString();
  return query ? `?${query}` : "";
}
