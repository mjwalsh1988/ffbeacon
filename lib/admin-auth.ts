/**
 * Server-side admin gating.
 *
 * Admin status is user_preferences.is_admin (migration 0018), which only the
 * service role can set. These helpers are the single source of truth for the
 * /admin space. Every admin page and the admin layout call requireAdmin();
 * the header calls the non-redirecting getIsAdmin() to decide whether to show
 * the Admin link. Never trust a client-supplied admin flag.
 */

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type ServerClient = SupabaseClient<Database>;

/**
 * Resolve whether the current session belongs to an admin. Pass an existing
 * server client to avoid creating a second one; otherwise one is created.
 * Returns false for anonymous visitors. Never throws on the unauthenticated
 * path.
 */
export async function getIsAdmin(supabase?: ServerClient): Promise<boolean> {
  const client = supabase ?? ((await createClient()) as ServerClient);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return false;
  const { data: prefs } = await client
    .from("user_preferences")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  return Boolean(prefs?.is_admin);
}

/**
 * Gate an admin-only server page/layout. Redirects to login when signed out and
 * to the user dashboard when signed in but not an admin, so a non-admin can
 * never render admin content. Returns the user id on success.
 *
 * Defense in depth: the layout calls this for the shell + redirect, and each
 * page calls it independently because Next.js may render a page's server code
 * concurrently with its layout.
 */
export async function requireAdmin(nextPath = "/admin"): Promise<{ userId: string }> {
  const supabase = (await createClient()) as ServerClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!prefs?.is_admin) {
    redirect("/my-beacon");
  }
  return { userId: user.id };
}
