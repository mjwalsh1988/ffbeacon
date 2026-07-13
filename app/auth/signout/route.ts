import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/http-origin";

/**
 * POST /auth/signout
 *
 * Same-origin guard (FFB-SEC-013): the sign-out buttons submit a same-origin form,
 * which carries an Origin header a cross-site page cannot forge. A cross-site request
 * is rejected without touching the session, so a hostile page can no longer silently
 * sign a visitor out. The redirect target stays fixed to this origin's home.
 */
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
