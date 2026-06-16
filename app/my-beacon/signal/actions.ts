"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  normalizeHandle,
  validateHandleFormat,
  DISPLAY_NAME_MAX,
  HEADLINE_MAX,
  BIO_MAX,
} from "@/lib/signal";

/**
 * Server actions for the My Signal editor. All writes go through the caller's
 * session client so the owner-only RLS policies apply, and the authoritative
 * handle triggers (migration 0068) enforce reserved words, reclaim blocking, and
 * the rename rate limit regardless of what we send. checkHandleAvailability uses
 * the service-role client because draft handles are invisible to anon/owner RLS,
 * so a plain query would miss handles taken by unpublished profiles.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export type HandleStatus =
  | "available"
  | "invalid"
  | "reserved"
  | "taken"
  | "unchanged";

// Map a database error (trigger RAISE or constraint violation) to friendly copy.
function mapHandleError(error: { message?: string; code?: string }): string {
  const m = error.message ?? "";
  if (m.includes("reserved_handle")) return "That handle is reserved.";
  if (m.includes("handle_unavailable")) {
    return "That handle was used by another profile and cannot be reused.";
  }
  if (m.includes("handle_change_rate_limited")) {
    return "You can change your handle again 30 days after your last change.";
  }
  if (error.code === "23505") return "That handle is already taken.";
  if (m.includes("signals_handle_check")) {
    return "Use 3 to 30 lowercase letters, numbers, or underscores.";
  }
  return "Could not save your handle. Please try again.";
}

export async function checkHandleAvailability(
  raw: string,
): Promise<{ status: HandleStatus; message: string }> {
  const handle = normalizeHandle(raw);
  const formatError = validateHandleFormat(handle);
  if (formatError) return { status: "invalid", message: formatError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Require a session. This action is service-role backed (it can see draft
  // handles), so leaving it open would let anyone enumerate which handles,
  // including unpublished ones, are taken.
  if (!user) {
    return { status: "invalid", message: "Sign in to check handle availability." };
  }

  const admin = createAdminClient();

  const { data: reserved } = await admin
    .from("signal_reserved_handles")
    .select("handle")
    .eq("handle", handle)
    .maybeSingle();
  if (reserved) return { status: "reserved", message: "That handle is reserved." };

  const { data: existing } = await admin
    .from("signals")
    .select("user_id")
    .eq("handle", handle)
    .maybeSingle();
  if (existing) {
    if (user && existing.user_id === user.id) {
      return { status: "unchanged", message: "This is already your handle." };
    }
    return { status: "taken", message: "That handle is already taken." };
  }

  const { data: historical } = await admin
    .from("signal_handle_history")
    .select("signal_id")
    .eq("old_handle", handle)
    .maybeSingle();
  if (historical) {
    if (user) {
      const { data: mine } = await admin
        .from("signals")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (mine && mine.id === historical.signal_id) {
        return { status: "available", message: "Available (your previous handle)." };
      }
    }
    return {
      status: "taken",
      message: "That handle was used by another profile and cannot be reused.",
    };
  }

  return { status: "available", message: "Available." };
}

export async function claimHandle(raw: string): Promise<ActionResult> {
  const handle = normalizeHandle(raw);
  const formatError = validateHandleFormat(handle);
  if (formatError) return { ok: false, error: formatError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: existing } = await supabase
    .from("signals")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return { ok: false, error: "You already have a Signal." };

  const metaName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const fallbackName = user.email ? user.email.split("@")[0] : "Creator";
  const displayName = (metaName || fallbackName).slice(0, DISPLAY_NAME_MAX);

  const { error } = await supabase
    .from("signals")
    .insert({ user_id: user.id, handle, display_name: displayName });
  if (error) return { ok: false, error: mapHandleError(error) };

  revalidatePath("/my-beacon/signal");
  return { ok: true };
}

export async function updateHandle(raw: string): Promise<ActionResult> {
  const handle = normalizeHandle(raw);
  const formatError = validateHandleFormat(handle);
  if (formatError) return { ok: false, error: formatError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { error } = await supabase
    .from("signals")
    .update({ handle, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: mapHandleError(error) };

  revalidatePath("/my-beacon/signal");
  return { ok: true };
}

export async function saveIdentity(input: {
  displayName: string;
  headline: string;
  bio: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Display name must be 1 to ${DISPLAY_NAME_MAX} characters.` };
  }
  const headline = input.headline.trim();
  if (headline.length > HEADLINE_MAX) {
    return { ok: false, error: `Headline must be ${HEADLINE_MAX} characters or fewer.` };
  }
  const bio = input.bio.trim();
  if (bio.length > BIO_MAX) {
    return { ok: false, error: `Bio must be ${BIO_MAX} characters or fewer.` };
  }

  const { error } = await supabase
    .from("signals")
    .update({
      display_name: displayName,
      headline: headline.length > 0 ? headline : null,
      bio: bio.length > 0 ? bio : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not save your details. Please try again." };

  revalidatePath("/my-beacon/signal");
  return { ok: true };
}

export async function setPublishState(input: {
  status: "draft" | "published";
  visibility: "public" | "private";
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: current } = await supabase
    .from("signals")
    .select("handle, published_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Claim your handle first." };

  // Stamp published_at the first time the profile is published; never clear it.
  const publishedAt =
    input.status === "published" && !current.published_at
      ? new Date().toISOString()
      : current.published_at;

  const { error } = await supabase
    .from("signals")
    .update({
      status: input.status,
      visibility: input.visibility,
      published_at: publishedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not update visibility. Please try again." };

  revalidatePath("/my-beacon/signal");
  revalidatePath(`/u/${current.handle}`);
  return { ok: true };
}
