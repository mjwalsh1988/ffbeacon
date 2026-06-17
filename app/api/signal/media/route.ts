import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidateProfileCaches } from "@/lib/signal-profile";
import { sniffImage } from "@/lib/signal/image-sniff";

/**
 * POST /api/signal/media  (avatar / banner upload for the owner's Signal)
 * DELETE /api/signal/media?kind=avatar|banner  (clear an image)
 *
 * Hardening:
 *   - auth required; same-origin only (x-requested-with header).
 *   - size cap per kind BEFORE processing.
 *   - magic-byte sniff: accept only JPEG/PNG/WebP. SVG (an XSS vector) and any
 *     other type are rejected; we never trust the client Content-Type.
 *   - re-encode with sharp to WebP. sharp drops all EXIF/ICC/XMP metadata by
 *     default, so geolocation and other metadata never survive, and the bytes we
 *     store are our own re-encoding, not the uploaded file.
 *   - avatar 512x512, banner 1600x500 (cover, downscale only via resize).
 *   - delete-on-replace: the user's prior file of this kind is removed first.
 *
 * Uploads use the caller's session client, so the bucket's owner-folder-scoped
 * RLS ("<uid>/...") authorizes the write. The bucket is public-read, so the
 * stored object is served to anyone via its public URL.
 */

export const runtime = "nodejs";

const BUCKET = "signal-media";

// Per-kind input caps. These are kept safely UNDER the hosting platform's
// serverless request-body limit (Vercel functions cap request bodies at ~4.5 MB
// and reject larger ones with an HTML error page BEFORE this handler runs, which
// the route cannot catch). The stored output is a downscaled WebP a few tens of
// KB regardless, so 4 MB of input is ample for any reasonable photo.
const KINDS = {
  avatar: { width: 512, height: 512, maxBytes: 4 * 1024 * 1024 },
  banner: { width: 1600, height: 500, maxBytes: 4 * 1024 * 1024 },
} as const;
type Kind = keyof typeof KINDS;

// Hard ceiling rejected before the body is buffered: the per-kind cap (4 MB)
// plus a little multipart overhead, staying under the ~4.5 MB platform limit.
const MAX_UPLOAD_BYTES = Math.round(4.4 * 1024 * 1024);

function isSameOrigin(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

// Thin wrappers so an unexpected throw becomes a clean JSON error (the client
// parses JSON; an HTML 500 page would surface as "Unexpected token '<'") and the
// real cause is logged server-side.
export async function POST(req: Request) {
  try {
    return await postImpl(req);
  } catch (err) {
    console.error("signal media POST failed:", err);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    return await deleteImpl(req);
  } catch (err) {
    console.error("signal media DELETE failed:", err);
    return NextResponse.json(
      { error: "Could not remove the image." },
      { status: 500 },
    );
  }
}

async function postImpl(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  // Reject oversized bodies before buffering the multipart payload into memory.
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

  const kind = String(form.get("kind") ?? "") as Kind;
  if (kind !== "avatar" && kind !== "banner") {
    return NextResponse.json({ error: "Invalid image kind" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const cfg = KINDS[kind];
  if (file.size > cfg.maxBytes) {
    return NextResponse.json(
      { error: `Image must be ${Math.round(cfg.maxBytes / 1024 / 1024)} MB or smaller.` },
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

  const { data: signal } = await supabase
    .from("signals")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!signal) {
    return NextResponse.json({ error: "Claim your handle first." }, { status: 400 });
  }

  let outBuf: Buffer;
  try {
    outBuf = await sharp(inputBuf, { failOn: "error", animated: false })
      .rotate() // bake in EXIF orientation before metadata is stripped
      .resize(cfg.width, cfg.height, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process that image." }, { status: 422 });
  }

  // Delete-on-replace. The bucket has no public SELECT policy (a public bucket
  // does not need one), so storage.list() requires the service role. We only
  // ever list/remove inside the caller's own "<uid>/" folder, so this stays
  // scoped to their files.
  const folder = user.id;
  const admin = createAdminClient();
  const { data: listed } = await admin.storage.from(BUCKET).list(folder, { limit: 100 });
  const stale = (listed ?? [])
    .filter((o) => o.name.startsWith(`${kind}-`))
    .map((o) => `${folder}/${o.name}`);
  if (stale.length > 0) {
    await admin.storage.from(BUCKET).remove(stale);
  }

  const path = `${folder}/${kind}-${Date.now()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, outBuf, { contentType: "image/webp", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const patch =
    kind === "avatar" ? { avatar_path: path } : { banner_path: path };
  const { error: updateError } = await supabase
    .from("signals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (updateError) {
    return NextResponse.json(
      { error: "Saved the image but could not update your profile." },
      { status: 500 },
    );
  }

  // The avatar/banner is part of the cached profile bundle + OG card, so bust
  // the profile caches now rather than waiting for the ISR window.
  await revalidateProfileCaches(supabase, user.id);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, kind, path, url: pub.publicUrl });
}

async function deleteImpl(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const kind = new URL(req.url).searchParams.get("kind") as Kind | null;
  if (kind !== "avatar" && kind !== "banner") {
    return NextResponse.json({ error: "Invalid image kind" }, { status: 400 });
  }

  const folder = user.id;
  const admin = createAdminClient();
  const { data: listed } = await admin.storage.from(BUCKET).list(folder, { limit: 100 });
  const stale = (listed ?? [])
    .filter((o) => o.name.startsWith(`${kind}-`))
    .map((o) => `${folder}/${o.name}`);
  if (stale.length > 0) {
    await admin.storage.from(BUCKET).remove(stale);
  }

  const patch =
    kind === "avatar" ? { avatar_path: null } : { banner_path: null };
  const { error: updateError } = await supabase
    .from("signals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (updateError) {
    return NextResponse.json({ error: "Could not remove the image." }, { status: 500 });
  }

  await revalidateProfileCaches(supabase, user.id);

  return NextResponse.json({ ok: true, kind });
}
