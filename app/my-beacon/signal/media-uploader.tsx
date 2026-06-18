"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { revalidateMySignal } from "@/app/my-beacon/rankings/actions";

/**
 * Avatar or banner uploader for the owner's Signal.
 *
 * The image is uploaded DIRECTLY from the browser to the public signal-media
 * Supabase Storage bucket (no server route, no native image library), exactly
 * like the profile avatar uploader. The bucket's owner-folder RLS ("<uid>/...")
 * authorizes the write, and the bucket itself enforces the allowed types
 * (JPG/PNG/WebP) and size cap. After a successful change we update the signals
 * row and bust the cached public profile via revalidateMySignal().
 *
 * Server-side cropping/resizing/metadata-stripping was removed deliberately; a
 * pure-JS in-browser version can be added later. For now this is a plain upload.
 */

const BUCKET = "signal-media";
const MAX_BYTES = 8 * 1024 * 1024; // matches the bucket's file_size_limit
const ACCEPTED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function MediaUploader({
  kind,
  initialUrl,
}: {
  kind: "avatar" | "banner";
  initialUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [status, setStatus] = useState<
    { kind: "idle" | "working" } | { kind: "error" | "success"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const isAvatar = kind === "avatar";
  const label = isAvatar ? "Avatar" : "Banner";
  const hint = isAvatar
    ? "JPG, PNG, or WebP. Max 8 MB."
    : "JPG, PNG, or WebP. Max 8 MB. Shown as a wide banner.";

  // Remove any existing files of THIS kind in the user's folder so a replace
  // never leaves an orphan and avatar/banner do not clobber each other.
  const removeExisting = async (
    supabase: ReturnType<typeof createClient>,
    userId: string,
  ) => {
    const { data: listed, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: 100 });
    if (error) throw error;
    const paths = (listed ?? [])
      .filter((item) => item.name.startsWith(`${kind}-`))
      .map((item) => `${userId}/${item.name}`);
    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove(paths);
      if (removeError) throw removeError;
    }
  };

  const send = (file: File) => {
    const ext = ACCEPTED[file.type];
    if (!ext) {
      setStatus({ kind: "error", message: "Use a JPG, PNG, or WebP image." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ kind: "error", message: "Image must be 8 MB or smaller." });
      return;
    }

    startTransition(async () => {
      setStatus({ kind: "working" });
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus({ kind: "error", message: "You need to be signed in." });
        return;
      }

      try {
        await removeExisting(supabase, user.id);
        const path = `${user.id}/${kind}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) throw uploadError;

        const patch =
          kind === "avatar" ? { avatar_path: path } : { banner_path: path };
        const { error: updateError } = await supabase
          .from("signals")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        if (updateError) throw updateError;

        await revalidateMySignal();
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        setPreviewUrl(pub.publicUrl);
        setStatus({ kind: "success", message: `${label} updated.` });
        router.refresh();
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Upload failed. Try again.",
        });
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      setStatus({ kind: "working" });
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus({ kind: "error", message: "You need to be signed in." });
        return;
      }
      try {
        await removeExisting(supabase, user.id);
        const patch =
          kind === "avatar" ? { avatar_path: null } : { banner_path: null };
        const { error: updateError } = await supabase
          .from("signals")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        if (updateError) throw updateError;

        await revalidateMySignal();
        setPreviewUrl(null);
        setStatus({ kind: "success", message: `${label} removed.` });
        router.refresh();
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Could not remove.",
        });
      }
    });
  };

  return (
    <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="mt-1 text-xs text-ink-subtle">{hint}</p>

      <div className="mt-3">
        {isAvatar ? (
          <ImageWithFallback src={previewUrl} alt="Your current Signal avatar" size={88} />
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Your current Signal banner"
            className="h-28 w-full rounded-card border border-line object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-28 w-full rounded-card border border-dashed border-line bg-base/60"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={`Choose ${label.toLowerCase()} image to upload`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) send(file);
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Upload aria-hidden="true" className="h-4 w-4" />
          {previewUrl ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        </button>
        {previewUrl && (
          <button
            type="button"
            disabled={pending}
            onClick={remove}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Remove
          </button>
        )}
      </div>

      <div aria-live="polite" role="status" className="min-h-[1.25rem]">
        {status.kind === "working" && <p className="mt-2 text-sm text-ink-muted">Working...</p>}
        {status.kind === "success" && (
          <p className="mt-2 text-sm text-signal-success">{status.message}</p>
        )}
        {status.kind === "error" && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
