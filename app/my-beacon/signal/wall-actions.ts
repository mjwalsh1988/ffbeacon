"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { revalidateProfileCaches } from "@/lib/signal-profile";
import {
  POST_BODY_MAX,
  POST_LINKS_MAX,
  codePointLength,
  countLinks,
  validateGifInput,
  type SignalGifInput,
} from "@/lib/signal";
import type { ActionResult } from "./actions";

export type PostImageInput = {
  path: string;
  alt: string;
  width: number;
  height: number;
};

const POST_IMAGES_MAX = 4;
const ALT_MAX = 420;

/** Validate the attached images: at most 4, each path must live inside the
 * caller's own "<uid>/posts/" folder and be a .webp (so a guessed path on another
 * user's folder or a non-image is rejected), each alt 1..420 chars, dimensions
 * positive integers. Returns cleaned rows or an error string. */
function validateImages(
  raw: unknown,
  userId: string,
): { ok: true; images: PostImageInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Could not read your images." };
  if (raw.length > POST_IMAGES_MAX) {
    return { ok: false, error: `Posts can include at most ${POST_IMAGES_MAX} images.` };
  }

  const prefix = `${userId}/posts/`;
  const cleaned: PostImageInput[] = [];
  for (const item of raw) {
    const path = typeof item?.path === "string" ? item.path : "";
    const alt = typeof item?.alt === "string" ? item.alt.trim() : "";
    const width = Number(item?.width);
    const height = Number(item?.height);

    if (
      !path.startsWith(prefix) ||
      !/^[0-9a-f-]{36}\.(webp|jpe?g|png)$/i.test(path.slice(prefix.length))
    ) {
      return { ok: false, error: "One of your images could not be attached." };
    }
    if (alt.length < 1 || alt.length > ALT_MAX) {
      return {
        ok: false,
        error: `Each image needs a description of 1 to ${ALT_MAX} characters.`,
      };
    }
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 10000 ||
      height > 10000
    ) {
      return { ok: false, error: "One of your images could not be attached." };
    }
    cleaned.push({ path, alt, width, height });
  }
  return { ok: true, images: cleaned };
}

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

export async function createPost(
  rawBody: string,
  images?: PostImageInput[],
  gifRaw?: unknown,
): Promise<ActionResult> {
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  const bodyError = validateBody(body);
  if (bodyError) return { ok: false, error: bodyError };

  const owner = await getOwnerSignalId();
  if (!owner.ok) return owner;

  const imageCheck = validateImages(images, owner.userId);
  if (!imageCheck.ok) return { ok: false, error: imageCheck.error };

  // A post is images XOR a GIF. The DB enforces this with triggers in both
  // directions (migration 0073); we reject the combination here for friendly copy.
  let gif: SignalGifInput | null = null;
  if (gifRaw !== undefined && gifRaw !== null) {
    if (imageCheck.images.length > 0) {
      return { ok: false, error: "A post can have images or a GIF, not both." };
    }
    const gifCheck = validateGifInput(gifRaw);
    if (!gifCheck.ok) return { ok: false, error: gifCheck.error };
    gif = gifCheck.gif;
  }

  const supabase = await createClient();
  const { data: post, error } = await supabase
    .from("signal_posts")
    .insert({ signal_id: owner.signalId, body, gif })
    .select("id")
    .maybeSingle();
  if (error || !post) return { ok: false, error: mapPostError(error ?? {}) };

  if (imageCheck.images.length > 0) {
    const rows = imageCheck.images.map((img, index) => ({
      post_id: post.id,
      storage_path: img.path,
      alt_text: img.alt,
      width: img.width,
      height: img.height,
      ordinal: index,
    }));
    const { error: imgError } = await supabase
      .from("signal_post_images")
      .insert(rows);
    if (imgError) {
      // The post exists but its images failed; remove the post so the creator
      // can retry cleanly rather than leaving a text-only post they did not mean.
      await supabase.from("signal_posts").delete().eq("id", post.id);
      return { ok: false, error: "Could not attach your images. Please try again." };
    }
  }

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
