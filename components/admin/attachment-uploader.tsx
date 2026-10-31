"use client";

/**
 * Attachments go from this browser straight to Storage. A server action body is
 * capped at 1 MB and a function request at about 4.5 MB, so a 10 MB file cannot
 * travel through one. Three steps: ask for a token (which writes the pending row),
 * upload with it, then finalize, which checks the object is really there.
 *
 * The JS client exposes no progress events, so there is no bar: the words say what
 * is happening, in a status region.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDeliverableAction,
  finalizeAttachmentAction,
  requestAttachmentUploadAction,
  retryAttachmentUploadAction,
  type UploadStart,
} from "@/app/admin/orders/actions";
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, ORDER_FILES_BUCKET } from "@/lib/commerce/constants";
import type { OrderDeliverable } from "@/lib/commerce/types";
import { createClient } from "@/lib/supabase/client";
import { ActionStatus, ADMIN_BUTTON, ADMIN_DANGER, ADMIN_LABEL } from "./order-action";

async function putFile(start: UploadStart, file: File): Promise<string | null> {
  if (!start.ok) return start.error;
  const { error } = await createClient()
    .storage.from(ORDER_FILES_BUCKET)
    .uploadToSignedUrl(start.path, start.token, file, { contentType: file.type });
  if (error) return "The upload did not finish. Try again.";
  const done = await finalizeAttachmentAction(start.deliverableId);
  return done.ok ? null : done.error;
}

export function AttachmentUploader({
  orderId,
  pendingRows,
}: {
  orderId: string;
  /** Rows whose first upload never finished. */
  pendingRows: OrderDeliverable[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [retryFor, setRetryFor] = useState<string | null>(null);

  const upload = (file: File, retryId: string | null) => {
    setFailed(false);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setFailed(true);
      setStatus("That file is over 10 MB.");
      return;
    }
    setStatus(`Uploading ${file.name}`);
    startTransition(async () => {
      const start = retryId
        ? await retryAttachmentUploadAction(retryId)
        : await requestAttachmentUploadAction(orderId, {
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
          });
      const error = await putFile(start, file);
      if (error) {
        setFailed(true);
        setStatus(error);
      } else {
        setStatus(`Uploaded ${file.name}`);
      }
      setRetryFor(null);
      if (input.current) input.current.value = "";
      router.refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await deleteDeliverableAction(id);
      setFailed(!result.ok);
      setStatus(result.ok ? "Removed." : result.error);
      router.refresh();
    });
  };

  return (
    <div>
      <label htmlFor="attachment-file" className={ADMIN_LABEL}>
        {retryFor ? "Choose the file again" : "Attach a file"}
      </label>
      <p id="attachment-hint" className="mt-0.5 text-[11px] text-ink-subtle">
        PDF, PNG, JPEG, WebP, plain text or Markdown, up to 10 MB
      </p>
      <input
        ref={input}
        id="attachment-file"
        type="file"
        accept={ATTACHMENT_MIME_TYPES.join(",")}
        aria-describedby="attachment-hint"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file, retryFor);
        }}
        className="mt-1 block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-card file:border file:border-line file:bg-base file:px-4 file:text-sm file:font-semibold file:text-ink"
      />
      {pendingRows.length > 0 && (
        <ul role="list" className="mt-2 space-y-2">
          {pendingRows.map((row) => (
            <li key={row.id} className="rounded-card border border-signal-warning/40 bg-signal-warning/10 p-3">
              <p className="break-all text-sm text-ink">
                {row.file_name}: Upload did not finish
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setRetryFor(row.id);
                    input.current?.click();
                  }}
                  className={ADMIN_BUTTON}
                >
                  Retry
                </button>
                <button type="button" disabled={pending} onClick={() => remove(row.id)} className={ADMIN_DANGER}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <ActionStatus status={status} failed={failed} />
      </div>
    </div>
  );
}
