"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "user-avatars";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Avatar uploader for a private Supabase Storage bucket.
 *
 * One avatar per user is guaranteed: every upload first lists and removes any
 * existing files in the user's own folder ("<uid>/...") before writing the new
 * one, so a user can never accumulate multiple avatars. All storage operations
 * are scoped to the caller's own folder by the bucket RLS policies; the path is
 * always prefixed with the user's id.
 */
export function AvatarUploader({
  initialAvatarUrl,
  initials,
}: {
  initialAvatarUrl: string | null;
  initials: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialAvatarUrl);
  const [status, setStatus] = useState<
    { kind: "idle" | "working" } | { kind: "error" | "success"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const removeExisting = async (
    supabase: ReturnType<typeof createClient>,
    userId: string,
  ) => {
    const { data: listed, error } = await supabase.storage
      .from(BUCKET)
      .list(userId, { limit: 100 });
    if (error) throw error;
    const paths = (listed ?? [])
      .filter((item) => item.name && item.name !== ".emptyFolderPlaceholder")
      .map((item) => `${userId}/${item.name}`);
    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove(paths);
      if (removeError) throw removeError;
    }
  };

  const onFile = (file: File) => {
    const ext = ACCEPTED[file.type];
    if (!ext) {
      setStatus({
        kind: "error",
        message: "Use a JPG, PNG, WebP, or GIF image.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({ kind: "error", message: "Image must be 5 MB or smaller." });
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
        // Enforce a single avatar: clear the folder, then write the new file.
        await removeExisting(supabase, user.id);
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) throw uploadError;

        const { error: prefsError } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: user.id,
              avatar_path: path,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (prefsError) throw prefsError;

        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, 60 * 60);
        setPreviewUrl(signed?.signedUrl ?? null);
        setStatus({ kind: "success", message: "Avatar updated." });
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

  const onRemove = () => {
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
        const { error: prefsError } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: user.id,
              avatar_path: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (prefsError) throw prefsError;
        setPreviewUrl(null);
        setStatus({ kind: "success", message: "Avatar removed." });
        router.refresh();
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Could not remove avatar.",
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
      <div className="flex items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL with
          // a rotating token; the optimizer would cache a soon-expired URL.
          <img
            src={previewUrl}
            alt="Your current avatar"
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-line bg-base text-2xl font-semibold text-brand-cyan"
          >
            {initials}
          </span>
        )}
        <div className="sm:hidden">
          <p className="text-sm font-medium text-ink">Profile photo</p>
          <p className="text-xs text-ink-subtle">JPG, PNG, WebP, or GIF. Max 5 MB.</p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="hidden text-sm font-medium text-ink sm:block">Profile photo</p>
        <p className="hidden text-xs text-ink-subtle sm:block">
          JPG, PNG, WebP, or GIF. Max 5 MB. Replacing removes your old one.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            aria-label="Choose an avatar image to upload"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so selecting the same file again still fires onChange.
              event.target.value = "";
              if (file) onFile(file);
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
          >
            <Upload aria-hidden="true" className="h-4 w-4" />
            {previewUrl ? "Replace avatar" : "Upload avatar"}
          </button>
          {previewUrl && (
            <button
              type="button"
              disabled={pending}
              onClick={onRemove}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Remove
            </button>
          )}
        </div>

        <div aria-live="polite" role="status" className="min-h-[1.25rem]">
          {status.kind === "working" && (
            <p className="mt-2 text-sm text-ink-muted">Working...</p>
          )}
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
    </div>
  );
}
