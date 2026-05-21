"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Revoke every session belonging to the current user EXCEPT the one this
 * request was made from. Mirrors Supabase's `signOut({ scope: "others" })`
 * so the caller stays signed in on this device but every other browser /
 * mobile session is invalidated.
 */
export async function revokeOtherSessions(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/my-beacon/account");
  return { ok: true };
}
