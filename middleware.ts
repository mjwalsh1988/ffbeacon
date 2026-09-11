import { updateSession } from "@/lib/supabase/middleware";
import { rankingsFormatRedirect } from "@/lib/rankings-format-redirect";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Supabase's OAuth completion redirects to the project's Site URL when
  // `redirectTo` doesn't match the dashboard allowlist. That can drop a
  // stray `?code=<uuid>` on any path (commonly `/`). Catch those before
  // they hit the page (which would render with a confusing query string)
  // and forward to /auth/callback, preserving any `next` param and the
  // `ff_oauth_return` cookie set by the link flow.
  const code = request.nextUrl.searchParams.get("code");
  const isCallbackRoute = request.nextUrl.pathname === "/auth/callback";
  if (code && !isCallbackRoute) {
    const forwardUrl = request.nextUrl.clone();
    forwardUrl.pathname = "/auth/callback";
    // Strip the code from the original URL's params to avoid a duplicate
    // when we copy them over, `code` will be re-added explicitly.
    return NextResponse.redirect(forwardUrl);
  }
  // A ?format= on a rankings URL is a permanent move to that format's own path
  // (lib/rankings-format-redirect.ts). It is answered here, before any render,
  // because app/rankings/(board)/loading.tsx flushes a 200 before a page-level redirect()
  // can run, which turned it into a meta refresh inside a 200.
  const rankingsRedirect = rankingsFormatRedirect(request);
  if (rankingsRedirect) return rankingsRedirect;
  return updateSession(request);
}

export const config = {
  matcher: [
    // api/donate/webhook is excluded deliberately. Middleware runs before the
    // route does, and updateSession touches Supabase Auth, so a forged
    // webhook carrying a syntactically valid auth cookie could force one
    // outbound Supabase Auth request per POST, before the signature check ever
    // ran. That endpoint authenticates itself with an HMAC and never reads a
    // session, so it needs nothing middleware provides.
    //
    // The rest of the exclusions are the routes that never read a session
    // either, so running the session refresh in front of them is pure cost:
    // the five crawler and machine-readable files, the OG image routes (which
    // render from an id in the path through the service-role client), and the
    // cron routes (which authenticate with CRON_SECRET). None of them is ever
    // the landing spot for the stray OAuth `?code=` the handler above catches.
    //
    // api/og/breakdown IS excluded from that exclusion, because it is the one
    // OG route that does not fit the sentence above. Its nine siblings build a
    // service-role client; that one builds the cookie-bound client and resolves
    // the reader's format and source preferences from the session, so skipping
    // the refresh there would silently drop a signed-in reader's preferences on
    // an expiring token. The negative lookahead reads awkwardly, and the
    // alternative was to change that route's client, which would move it from
    // the anon RLS context to service_role for a saving of one request.
    //
    // `llms(?:-full)?\.txt$` covers both machine-readable documents. They are
    // the same kind of route as the sitemaps: public, cached, and reading no
    // session, so running the auth refresh in front of either is pure cost.
    //
    // Every literal below ends at a boundary, either a slash or the end of the
    // path. Without that, `/llms.txt.php` and `/sitemap.xml.bak` are excluded
    // too, which is inert today only because nothing is routed under those
    // prefixes.
    "/((?!api/donate/webhook$|api/cron/|api/og/(?!breakdown/)|sitemap\\.xml$|sitemaps/|brief/rss\\.xml$|llms(?:-full)?\\.txt$|_next/static|_next/image|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
