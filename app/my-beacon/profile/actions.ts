"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_NAME = 80;
const MAX_BIO = 2000;

/**
 * Save the fields the edit-profile form owns directly: the auth user's
 * display name (user_metadata), and the owner's first/last name and bio on
 * user_preferences. The caller is re-derived from the request-scoped session
 * client; there is no id to trust from the form, `updateUser` and the
 * upsert both always target the signed-in user.
 *
 * THE SLEEPER USERNAME IS NOT WRITTEN HERE. app/actions/sleeper-handle.ts is
 * the only writer of that field (see the comment on ProfileForm for why), and
 * the form calls it separately after this action succeeds.
 */
export async function saveProfile(input: {
  firstName: string;
  lastName: string;
  displayName: string;
  bio: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const displayName =
    typeof input.displayName === "string"
      ? input.displayName.trim().slice(0, MAX_NAME)
      : "";
  const firstName =
    typeof input.firstName === "string"
      ? input.firstName.trim().slice(0, MAX_NAME)
      : "";
  const lastName =
    typeof input.lastName === "string"
      ? input.lastName.trim().slice(0, MAX_NAME)
      : "";
  const bio = typeof input.bio === "string" ? input.bio.trim().slice(0, MAX_BIO) : "";

  // 1) Display name lives on the auth user, not our table.
  const { error: authError } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });
  if (authError) return { ok: false, error: authError.message };

  // 2) Name and bio.
  const { error: prefsError } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      first_name: firstName.length > 0 ? firstName : null,
      last_name: lastName.length > 0 ? lastName : null,
      bio: bio.length > 0 ? bio : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (prefsError) return { ok: false, error: prefsError.message };

  revalidatePath("/my-beacon/profile");
  return { ok: true };
}
