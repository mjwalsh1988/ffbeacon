"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2 } from "lucide-react";
import { ImageWithFallback } from "@/components/image-with-fallback";

// Kept in sync with the per-kind cap in app/api/signal/media/route.ts, which is
// held under the hosting platform's ~4.5 MB request-body limit. Checking here
// first means an oversized file gets an accessible message instead of being
// rejected by the platform with an uncatchable HTML error page.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Read a fetch Response as JSON without throwing on a non-JSON body. If the
 * platform returns an HTML error page (e.g. an oversized request rejected before
 * our route runs, or a gateway timeout), blindly calling res.json() would throw
 * "Unexpected token '<'". This returns a meaningful message instead.
 */
async function readResult(
  res: Response,
): Promise<{ ok?: boolean; url?: string; error?: string }> {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      error:
        res.status === 413
          ? "That image is too large. Choose one under 4 MB."
          : "Upload failed. Please try again with a smaller image.",
    };
  }
}

/**
 * Avatar or banner uploader for the owner's Signal. The file is POSTed to
 * /api/signal/media, which validates magic bytes, re-encodes to WebP (stripping
 * metadata), enforces dimensions, and stores it in the public signal-media
 * bucket. This component only previews and reports status; all hardening lives
 * server-side. Status is announced via a polite live region (errors assertive).
 */
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
    ? "JPG, PNG, or WebP. Max 4 MB. Cropped to a square."
    : "JPG, PNG, or WebP. Max 4 MB. Cropped to a wide banner.";

  const send = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setStatus({
        kind: "error",
        message: `That ${label.toLowerCase()} is too large. Choose an image under 4 MB.`,
      });
      return;
    }
    startTransition(async () => {
      setStatus({ kind: "working" });
      try {
        const body = new FormData();
        body.set("kind", kind);
        body.set("file", file);
        const res = await fetch("/api/signal/media", {
          method: "POST",
          headers: { "x-requested-with": "ff-beacon" },
          body,
        });
        const json = await readResult(res);
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "Upload failed.");
        }
        setPreviewUrl(json.url ?? null);
        setStatus({ kind: "success", message: `${label} updated.` });
        router.refresh();
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Upload failed. Try again.",
        });
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      setStatus({ kind: "working" });
      try {
        const res = await fetch(`/api/signal/media?kind=${kind}`, {
          method: "DELETE",
          headers: { "x-requested-with": "ff-beacon" },
        });
        const json = await readResult(res);
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not remove.");
        setPreviewUrl(null);
        setStatus({ kind: "success", message: `${label} removed.` });
        router.refresh();
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not remove.",
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
