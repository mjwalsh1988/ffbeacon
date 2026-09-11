import { NextResponse, type NextRequest } from "next/server";
import { RANKINGS_HUB_VIEW_PARAM } from "@/lib/rankings-hub";

/**
 * A `?format=` on a rankings URL, answered with a real permanent redirect.
 *
 * Two shapes reach here, and both used to send a crawler a mixed signal
 * (docs/seo-audit/seo-audit-and-plan.md, finding A04):
 *
 * - /rankings?format=X is how every format board was addressed before each got
 *   its own path on 2026-07-29. The hub rendered board X under a canonical
 *   naming /rankings, which shows the default board, so old links and old index
 *   entries never consolidated onto /rankings/X.
 * - /rankings/Y?format=X is what the header's format dropdown pushes on a
 *   format page. The page answered it with redirect(), but
 *   app/rankings/loading.tsx had already flushed a 200, so the redirect went
 *   out as a one-second meta refresh inside a 200 whose canonical still named Y.
 *
 * Both now get a 308 to /rankings/X before anything renders, with `format`
 * removed and every other parameter (position, source) kept in its original
 * order. X equal to Y just drops the duplicate parameter.
 *
 * The slug is checked for SHAPE only, never looked up: formats live in the
 * database and middleware must not query it. A well-formed slug that is not an
 * active format lands on /rankings/X, whose page answers it with notFound(),
 * exactly as a hand-typed bad path does. A malformed value is dropped and the
 * reader stays on the page they asked for. The shape check is also what keeps
 * this from being an open redirect: the destination is always this origin's
 * /rankings/<lowercase-slug>.
 *
 * Saving the reader's preference is not this code's job. The dropdown saves it
 * through a server action (components/format-toggle.tsx) independently of the
 * URL it pushes, so the redirect has nothing to lose.
 *
 * One deliberate difference from the plan's sketch, which checked the slug
 * against a static list: /rankings?format=<well-formed slug that is not an
 * active format> used to render the hub with the default board, and is now a
 * 308 to a page that says the format was not found. A static list was rejected
 * because it drifts: a format added in the database but not to the list would
 * have its dropdown choice silently dropped on the hub.
 *
 * The case that would matter is a RETIRED format, whose old links would start
 * landing on that page. Checked 2026-09-11: all 13 rows in format_configs are
 * active and no migration has ever deleted, renamed or deactivated one, so every
 * slug the site has ever published still resolves. IF A FORMAT IS EVER RETIRED,
 * add its slug here as a value to drop (the reader stays on the hub) rather than
 * redirect.
 */
const FORMAT_SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FORMAT_SLUG_LENGTH = 64;
/** /rankings or /rankings/<one segment>. Deeper paths are not rankings boards. */
const RANKINGS_BOARD_PATH = /^\/rankings(?:\/[^/]+)?$/;

export function rankingsFormatRedirect(
  request: NextRequest,
): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  if (!RANKINGS_BOARD_PATH.test(pathname)) return null;

  const raw = searchParams.get("format");
  if (raw === null) return null;
  // Slugs are lowercase. An old link or a hand-typed URL in capitals still
  // names the same format, so it goes to that format rather than being dropped.
  const format = raw.trim().toLowerCase();

  const url = request.nextUrl.clone();
  url.searchParams.delete("format");
  if (
    format.length <= MAX_FORMAT_SLUG_LENGTH &&
    FORMAT_SLUG_SHAPE.test(format)
  ) {
    url.pathname = `/rankings/${format}`;
    // Leaving the hub for a board: the hub's "show me every format" flag
    // (lib/rankings-hub.ts) means nothing on a board, so it does not follow.
    url.searchParams.delete(RANKINGS_HUB_VIEW_PARAM);
  }
  return NextResponse.redirect(url, 308);
}
