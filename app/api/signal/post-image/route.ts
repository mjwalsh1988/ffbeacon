import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { sniffImage } from "@/lib/signal/image-sniff";

/**
 * POST /api/signal/post-image  (upload one image for a Wall post)
 *
 * Returns the stored path + public URL + dimensions; it does NOT create or touch
 * any DB row. The composer holds the returned path and the alt text the creator
 * types, and the createPost server action persists the signal_post_images rows
 * when the post is submitted. (An object uploaded but never attached is a
 * harmless orphan; a cleanup reaper is a deferred follow-up.)
 *
 * Hardening (same posture as /api/signal/media):
 *   - same-origin only (x-requested-with header); auth required.
 *   - Content-Length ceiling before buffering; per-file size cap.
 *   - magic-byte sniff: JPEG/PNG/WebP only, SVG and everything else rejected; the
 *     client Content-Type is never trusted.
 *   - sharp re-encode to WebP, which strips all EXIF/ICC/XMP metadata. Unlike the
 *     avatar/banner route we do NOT crop: fit "inside" with withoutEnlargement
 *     downscales the longest edge to 1600 while preserving the creator's framing.
 *
 * Upload uses the caller's session client so the bucket's owner-folder RLS
 * ("<uid>/...") authorizes the write to "<uid>/posts/<uuid>.webp".
 */

export const runtime = "nodejs";

const BUCKET = "signal-media";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const MAX_EDGE = 1600;

function isSameOrigin(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image is too large." }, { status: 413 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image must be ${Math.round(MAX_BYTES / 1024 / 1024)} MB or smaller.` },
      { status: 413 },
    );
  }

  const inputBuf = Buffer.from(await file.arrayBuffer());
  if (!sniffImage(inputBuf)) {
    return NextResponse.json(
      { error: "Upload a JPEG, PNG, or WebP image. SVG and other formats are not allowed." },
      { status: 415 },
    );
  }

  // Owner must have a Signal to post images to.
  const { data: signal } = await supabase
    .from("signals")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!signal) {
    return NextResponse.json({ error: "Claim your handle first." }, { status: 400 });
  }

  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    const result = await sharp(inputBuf, { failOn: "error", animated: false })
      .rotate() // bake in EXIF orientation before metadata is stripped
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    out = { data: result.data, info: { width: result.info.width, height: result.info.height } };
  } catch {
    return NextResponse.json({ error: "Could not process that image." }, { status: 422 });
  }

  const path = `${user.id}/posts/${randomUUID()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, out.data, { contentType: "image/webp", upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({
    ok: true,
    path,
    url: pub.publicUrl,
    width: out.info.width,
    height: out.info.height,
  });
}
