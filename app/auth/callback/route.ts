import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  SOURCE_COOKIE,
  FORMAT_COOKIE,
  PREFERENCE_COOKIE_OPTIONS,
  VALID_PREFERENCE_SLUG as VALID_SLUG,
} from "@/lib/preferences";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Resolution order for the post-auth landing path:
  //   1. `?next=` URL param (login flow, signInWithOAuth threads this
  //      through reliably)
  //   2. `ff_oauth_return` cookie (link flow, set by identity-manager
  //      before linkIdentity, because that endpoint doesn't always
  //      preserve redirectTo query strings)
  //   3. "/" (default landing for password / magic-link confirmations)
  const nextParam = searchParams.get("next");
  const cookieReturn = request.cookies.get("ff_oauth_return")?.value ?? null;
  const decodedCookieReturn = cookieReturn
    ? safeDecode(cookieReturn)
    : null;
  const candidate = nextParam ?? decodedCookieReturn ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Both slashes, for the reason app/login/login-form.tsx states: a leading
  // "/" followed by a backslash enters the URL authority state the same way
  // "//" does. This one is already safe because the result is concatenated
  // onto `origin`, but the two checks should not disagree about what a
  // same-origin path is.
  const redirectPath =
    candidate.startsWith("/") &&
    candidate[1] !== "/" &&
    candidate[1] !== "\\"
      ? candidate
      : "/";
  const response = NextResponse.redirect(`${origin}${redirectPath}`);

  // Consume the one-shot return cookie so it doesn't influence later
  // unrelated callbacks (e.g. a subsequent password reset flow).
  if (cookieReturn) {
    response.cookies.set("ff_oauth_return", "", { path: "/", maxAge: 0 });
  }

  // Sync saved preferences from DB into cookies so the next server render
  // already reflects this user's settings (cross-device login experience).
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("default_source_slug, default_format_config_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (
        prefs?.default_source_slug &&
        VALID_SLUG.test(prefs.default_source_slug)
      ) {
        response.cookies.set(
          SOURCE_COOKIE,
          prefs.default_source_slug,
          PREFERENCE_COOKIE_OPTIONS,
        );
      }
      if (prefs?.default_format_config_id) {
        const { data: format } = await supabase
          .from("format_configs")
          .select("slug")
          .eq("id", prefs.default_format_config_id)
          .maybeSingle();
        if (format?.slug && VALID_SLUG.test(format.slug)) {
          response.cookies.set(FORMAT_COOKIE, format.slug, PREFERENCE_COOKIE_OPTIONS);
        }
      }
    }
  } catch {
    // Cookie sync is best-effort; sign-in succeeds regardless.
  }

  return response;
}

/**
 * Defensive decode for the return-path cookie. A malformed value (e.g.
 * a stale entry from a previous deploy) should never throw and crash the
 * auth callback, it just falls through to the default landing.
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
