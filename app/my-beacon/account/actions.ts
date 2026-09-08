"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

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

/**
 * Request an email change. Supabase doesn't swap the address immediately, it
 * sends a confirmation link to BOTH the old and new addresses, and the
 * change only takes effect once both are clicked. The caller is re-derived
 * from the request-scoped session client; there is no id or ownership claim
 * to trust here, `updateUser` always targets the signed-in session.
 */
export async function updateEmail(rawEmail: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > 320 || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (email === (user.email ?? "").toLowerCase()) {
    return { ok: false, error: "That is already your email address." };
  }

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/my-beacon/account");
  return { ok: true };
}

/**
 * Change (or set) the account password. When the account already has a
 * password, `currentPassword` is re-verified against the caller's OWN email
 * via `signInWithPassword` before the update, so a live session cookie alone
 * is never enough to hijack the account permanently. `hasPassword` is
 * re-derived here from `account_has_password` (never trusted from the
 * client): a request claiming "no password yet" cannot skip verification on
 * an account that already has one. Password strength is re-checked
 * server-side too, since this is the actual enforcement boundary now, not
 * just the form's live checklist.
 */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const strengthError = passwordStrengthError(newPassword);
  if (strengthError) return { ok: false, error: strengthError };

  const { data: hasPasswordRpc } = await supabase.rpc("account_has_password");
  const hasEmailIdentity = (user.identities ?? []).some(
    (identity) => identity.provider === "email",
  );
  const hasPassword = hasEmailIdentity || hasPasswordRpc === true;

  if (hasPassword) {
    const currentPassword =
      typeof input.currentPassword === "string" ? input.currentPassword : "";
    if (!user.email) {
      return {
        ok: false,
        error: "Account has no email on file; can't verify password.",
      };
    }
    if (currentPassword.length === 0) {
      return { ok: false, error: "Enter your current password." };
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      return { ok: false, error: "Current password is incorrect." };
    }
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/my-beacon/account");
  return { ok: true };
}

const MANAGEABLE_PROVIDERS = ["google", "discord"] as const;

/**
 * Disconnect a linked sign-in provider (Google or Discord). The identity is
 * looked up on the CALLER'S OWN `user.identities` array by id, never trusted
 * as a full object from the client (the client used to have to fabricate one
 * to satisfy the SDK's shape; this action passes Supabase's own object
 * straight through). The "don't strand the account" guard is re-derived
 * server-side too: a client-side count is a UI courtesy, not a security
 * boundary, so we recompute hasPassword and the remaining OAuth count from
 * the caller's own session rather than trusting whatever the form last saw.
 */
export async function unlinkProviderIdentity(
  identityId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const identities = user.identities ?? [];
  const target = identities.find(
    (identity) => (identity.identity_id ?? identity.id) === identityId,
  );
  if (!target) return { ok: false, error: "Could not find that connection." };

  const { data: hasPasswordRpc } = await supabase.rpc("account_has_password");
  const hasEmailIdentity = identities.some((identity) => identity.provider === "email");
  const hasPassword = hasEmailIdentity || hasPasswordRpc === true;

  const oauthIdentityCount = identities.filter((identity) =>
    (MANAGEABLE_PROVIDERS as readonly string[]).includes(identity.provider),
  ).length;
  const remainingOauth =
    (MANAGEABLE_PROVIDERS as readonly string[]).includes(target.provider)
      ? oauthIdentityCount - 1
      : oauthIdentityCount;
  if (!hasPassword && remainingOauth < 1) {
    return {
      ok: false,
      error:
        "Can't disconnect your only sign-in method. Set a password first or link another provider.",
    };
  }

  const { error } = await supabase.auth.unlinkIdentity(target);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/my-beacon/account");
  return { ok: true };
}

/** Mirrors the client-side checklist in password-form.tsx so a direct call to
 * this action can never save a password weaker than what the form displays
 * as required. Keep the two rule sets in sync. */
function passwordStrengthError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Password needs a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password needs an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password needs a symbol.";
  return null;
}
