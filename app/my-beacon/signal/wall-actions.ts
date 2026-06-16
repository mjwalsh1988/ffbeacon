"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { revalidateProfileCaches } from "@/lib/signal-profile";
import {
  POST_BODY_MAX,
  POST_LINKS_MAX,
  codePointLength,
  countLinks,
} from "@/lib/signal";
import type { ActionResult } from "./actions";

/**
 * Owner-only server actions for the Signal Wall. Posts belong to the owner's
 * Signal (signal_posts has no author column; authorship is the parent signal's
 * owner), so every write goes through the caller's session client and the
 * owner-only RLS policies on signal_posts authorize it. The BEFORE INSERT/UPDATE
 * trigger (migrations 0061/0067) is the authoritative backstop: it forces
 * created_at = now(), enforces the rate-limit windows counting hidden posts, and
 * caps links on both insert and update. We validate client-equivalent rules here
 * for friendly copy and map the trigger's RAISE tokens to readable errors.
 */

// Map a database error (trigger RAISE or constraint violation) to friendly copy.
function mapPostError(error: { message?: string }): string {
  const m = error.message ?? "";
  if (m.includes("wait at least 15 seconds")) {
    return "Slow down. Wait at least 15 seconds between posts.";
  }
  if (m.includes("at most 10 posts per hour")) {
    return "You have reached the limit of 10 posts per hour. Try again later.";
  }
  if (m.includes("at most 40 posts per day")) {
    return "You have reached the limit of 40 posts per day. Try again tomorrow.";
  }
  if (m.includes("too_many_links")) {
    return `Posts can include at most ${POST_LINKS_MAX} links.`;
  }
  if (m.includes("signal_posts_body_check")) {
    return `Posts must be 1 to ${POST_BODY_MAX} characters.`;
  }
  return "Could not save your post. Please try again.";
}

/** Validate a body against the same rules the DB enforces. Returns an error
 * string, or null when acceptable. */
function validateBody(body: string): string | null {
  const len = codePointLength(body);
  if (len < 1) return "Write something first.";
  if (len > POST_BODY_MAX) {
    return `Posts must be ${POST_BODY_MAX} characters or fewer.`;
  }
  if (countLinks(body) > POST_LINKS_MAX) {
    return `Posts can include at most ${POST_LINKS_MAX} links.`;
  }
  return null;
}

async function getOwnerSignalId(): Promise<
  | { ok: true; userId: string; signalId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: signal } = await supabase
    .from("signals")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!signal) return { ok: false, error: "Claim your handle first." };

  return { ok: true, userId: user.id, signalId: signal.id };
}

export async function createPost(rawBody: string): Promise<ActionResult> {
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  const bodyError = validateBody(body);
  if (bodyError) return { ok: false, error: bodyError };

  const owner = await getOwnerSignalId();
  if (!owner.ok) return owner;

  const supabase = await createClient();
  const { error } = await supabase
    .from("signal_posts")
    .insert({ signal_id: owner.signalId, body });
  if (error) return { ok: false, error: mapPostError(error) };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, owner.userId);
  return { ok: true };
}

export async function updatePost(
  postId: string,
  rawBody: string,
): Promise<ActionResult> {
  if (typeof postId !== "string" || postId.length === 0) {
    return { ok: false, error: "Could not find that post." };
  }
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  const bodyError = validateBody(body);
  if (bodyError) return { ok: false, error: bodyError };

  const owner = await getOwnerSignalId();
  if (!owner.ok) return owner;

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  // RLS update_own scopes this to posts on the caller's own Signal. Match
  // signal_id too so a guessed id on another Signal affects zero rows.
  const { data, error } = await supabase
    .from("signal_posts")
    .update({ body, edited_at: nowIso, updated_at: nowIso })
    .eq("id", postId)
    .eq("signal_id", owner.signalId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: mapPostError(error) };
  if (!data) return { ok: false, error: "Could not find that post." };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, owner.userId);
  return { ok: true };
}

export async function deletePost(postId: string): Promise<ActionResult> {
  if (typeof postId !== "string" || postId.length === 0) {
    return { ok: false, error: "Could not find that post." };
  }

  const owner = await getOwnerSignalId();
  if (!owner.ok) return owner;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signal_posts")
    .delete()
    .eq("id", postId)
    .eq("signal_id", owner.signalId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Could not delete that post. Please try again." };
  if (!data) return { ok: false, error: "Could not find that post." };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, owner.userId);
  return { ok: true };
}

export async function setPostPinned(
  postId: string,
  pinned: boolean,
): Promise<ActionResult> {
  if (typeof postId !== "string" || postId.length === 0) {
    return { ok: false, error: "Could not find that post." };
  }

  const owner = await getOwnerSignalId();
  if (!owner.ok) return owner;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signal_posts")
    .update({ pinned: Boolean(pinned), updated_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("signal_id", owner.signalId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Could not update that post. Please try again." };
  if (!data) return { ok: false, error: "Could not find that post." };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, owner.userId);
  return { ok: true };
}
