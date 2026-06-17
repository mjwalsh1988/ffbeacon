import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getIsAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { sniffImage } from "@/lib/signal/image-sniff";

/**
 * POST /api/admin/signal/reaction-emoji  (admin upload of a custom reaction image)
 *
 * Returns the stored path + public URL + dimensions; it writes NO DB row. The
 * admin reaction catalog form holds the returned path and persists it on
 * signal_reaction_types via a requireAdmin server action when the type is saved.
 *
 * This is the ONLY write path into the signal-reaction-emojis bucket, and it is
 * admin-only and service-role-backed (the bucket has no client write policy).
 *
 * Hardening (same posture as /api/signal/post-image, tightened for reactions):
 *   - same-origin only (x-requested-with header).
 *   - admin only (getIsAdmin; never trusts the client).
 *   - Content-Length ceiling before buffering; per-file size cap.
 *   - magic-byte sniff: JPEG/PNG/WebP only, SVG and everything else rejected; the
 *     client Content-Type is never trusted.
 *   - sharp re-encode to a STATIC WebP (animated: false flattens any animation to
 *     the first frame), squared down to at most 256x256, all EXIF/ICC/XMP metadata
 *     stripped. Quality steps down until the output is at or under ~100 KB.
 */

export const runtime = "nodejs";

const BUCKET = "signal-reaction-emojis";
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // raw upload ceiling before processing
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024; // Content-Length guard
const MAX_EDGE = 256;
const TARGET_MAX_BYTES = 100 * 1024; // ~100 KB output cap
const QUALITY_STEPS = [80, 65, 50, 40, 30];

function isSameOrigin(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  if (!(await getIsAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image is too large." }, { status: 413 });
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
  if (file.size > MAX_INPUT_BYTES) {
    return NextResponse.json(
      { error: `Image must be ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB or smaller.` },
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

  // Re-encode to a static WebP at <= 256x256, stepping quality down until the
  // output is under the ~100 KB cap.
  let out: { data: Buffer; width: number; height: number } | null = null;
  try {
    for (const quality of QUALITY_STEPS) {
      const result = await sharp(inputBuf, { failOn: "error", animated: false })
        .rotate() // bake in EXIF orientation before metadata is stripped
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      if (result.data.length <= TARGET_MAX_BYTES || quality === QUALITY_STEPS[QUALITY_STEPS.length - 1]) {
        out = { data: result.data, width: result.info.width, height: result.info.height };
        break;
      }
    }
  } catch {
    return NextResponse.json({ error: "Could not process that image." }, { status: 422 });
  }

  if (!out || out.data.length > TARGET_MAX_BYTES) {
    return NextResponse.json(
      { error: "Could not compress that image small enough. Try a simpler image." },
      { status: 422 },
    );
  }

  const admin = createAdminClient();
  const path = `reactions/${randomUUID()}.webp`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, out.data, { contentType: "image/webp", upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({
    ok: true,
    path,
    url: pub.publicUrl,
    width: out.width,
    height: out.height,
  });
}
