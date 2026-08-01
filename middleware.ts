import { updateSession } from "@/lib/supabase/middleware";
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
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
