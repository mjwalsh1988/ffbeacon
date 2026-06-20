import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/guide/viewer
 *
 * Lazy prefill source for the Signal Guide submit form. Returns the signed-in
 * visitor's name and email so the form can pre-populate them; returns nulls for
 * anonymous visitors. Session-scoped (uses the cookie-bound client), returns only
 * the caller's own identity, and is never cached.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { name: null, email: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Name prefill priority: the profile first/last name on user_preferences
  // (migration 0057), then the account display name on auth.users user_metadata,
  // then nothing.
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("first_name, last_name")
    .eq("user_id", user.id)
    .maybeSingle();
  let name = [prefs?.first_name, prefs?.last_name].filter(Boolean).join(" ").trim();

  if (!name) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.display_name === "string" && meta.display_name.trim()) {
      name = meta.display_name.trim();
    }
  }

  return NextResponse.json(
    { name: name || null, email: user.email ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
