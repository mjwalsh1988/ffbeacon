"use client";

/**
 * Writing the review. Sections are drafts until Publish; attachments arrive through
 * the uploader. The preview renders through the same component the customer sees,
 * so what is previewed is what lands.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  deleteDeliverableAction,
  moveDeliverableAction,
  publishDeliveryAction,
  resendDeliveryEmailAction,
  saveDeliverableSectionAction,
} from "@/app/admin/orders/actions";
import type { OrderDeliverable } from "@/lib/commerce/types";
import { RULED } from "@/components/league-blueprint/sheet";
import { RichTextView } from "@/components/commerce/rich-text-view";
import { StatusChip } from "@/components/commerce/status-chip";
import { AttachmentUploader } from "./attachment-uploader";
import {
  ActionStatus,
  ADMIN_BUTTON,
  ADMIN_DANGER,
  ADMIN_FIELD,
  ADMIN_LABEL,
  ADMIN_PRIMARY,
  useOrderAction,
} from "./order-action";

const SUGGESTIONS = [
  "The short version",
  "Direction",
  "Position by position",
  "Buy, sell, hold",
  "Trades to pursue",
  "This week's lineup",
  "Draft capital",
  "Closing note",
];

const HINT = "Blank line for a paragraph, ## for a heading, - for a bullet";

function SectionForm({
  orderId,
  section,
  sortOrder,
  onDone,
}: {
  orderId: string;
  section: OrderDeliverable | null;
  sortOrder: number;
  onDone: () => void;
}) {
  const key = section?.id ?? "new";
  const [title, setTitle] = useState(section?.title ?? "");
  const [body, setBody] = useState(section?.body ?? "");
  const { run, pending, status, failed } = useOrderAction();
  // The form replaces the button that opened it, so focus would otherwise fall to
  // the document body and the reader would have to hunt for the fields.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveDeliverableSectionAction({
              id: section?.id ?? null,
              orderId,
              title,
              body,
              sortOrder,
            }),
          onDone,
        );
      }}
      className="space-y-3 rounded-card border border-line-accent bg-base/30 p-3"
    >
      <div>
        <label htmlFor={`section-title-${key}`} className={ADMIN_LABEL}>
          Title
        </label>
        <input
          id={`section-title-${key}`}
          ref={titleRef}
          type="text"
          list="section-title-suggestions"
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={`${ADMIN_FIELD} min-h-11`}
        />
        <datalist id="section-title-suggestions">
          {SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor={`section-body-${key}`} className={ADMIN_LABEL}>
          Body
        </label>
        <p id={`section-hint-${key}`} className="mt-0.5 text-[11px] text-ink-subtle">
          {HINT}
        </p>
        <textarea
          id={`section-body-${key}`}
          rows={12}
          maxLength={20000}
          value={body}
          aria-describedby={`section-hint-${key}`}
          onChange={(event) => setBody(event.target.value)}
          className={`${ADMIN_FIELD} font-mono`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={ADMIN_BUTTON}>
          {pending ? "Saving..." : "Save section"}
        </button>
        <button type="button" onClick={onDone} className={ADMIN_BUTTON}>
          Cancel
        </button>
      </div>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}

export function DeliverableEditor({
  orderId,
  deliverables,
  disputeOpen,
  delivered,
  everDelivered,
  paid,
}: {
  orderId: string;
  deliverables: OrderDeliverable[];
  disputeOpen: boolean;
  delivered: boolean;
  everDelivered: boolean;
  paid: boolean;
}) {
  const sections = deliverables.filter((d) => d.kind === "section");
  const attachments = deliverables.filter((d) => d.kind === "attachment");
  const pendingUploads = attachments.filter((d) => d.upload_state === "pending");
  const ready = attachments.filter((d) => d.upload_state === "ready");

  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notify, setNotify] = useState(false);
  const { run, pending, status, failed } = useOrderAction();

  const nextSort = (sections.at(-1)?.sort_order ?? 0) + 10;
  const blockedByUpload = pendingUploads.length > 0;
  const canPublish =
    paid && sections.length > 0 && !blockedByUpload && (!disputeOpen || acknowledged);
  const publishReason = !paid
    ? "Only a paid order can be delivered."
    : sections.length === 0
      ? "Add at least one section first."
      : blockedByUpload
        ? "An upload did not finish. Retry or remove it first."
        : disputeOpen && !acknowledged
          ? "Tick the box above first."
          : "";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-ink">Sections</h3>
        {sections.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">No sections yet.</p>
        ) : (
          <ul role="list" className={`mt-2 ${RULED}`}>
            {sections.map((section, i) => (
              <li key={section.id} className="py-2">
                {editing === section.id ? (
                  <SectionForm
                    orderId={orderId}
                    section={section}
                    sortOrder={section.sort_order}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-ink">
                      {section.title}
                    </span>
                    <StatusChip
                      chip={
                        section.status === "published"
                          ? { word: "Published", tone: "positive" }
                          : { word: "Draft", tone: "muted" }
                      }
                    />
                    <span className="flex gap-1">
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        aria-label={`Move ${section.title} up`}
                        onClick={() => run(() => moveDeliverableAction(orderId, section.id, "up"))}
                        className={`${ADMIN_BUTTON} w-11 px-0`}
                      >
                        <ChevronUp aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === sections.length - 1}
                        aria-label={`Move ${section.title} down`}
                        onClick={() => run(() => moveDeliverableAction(orderId, section.id, "down"))}
                        className={`${ADMIN_BUTTON} w-11 px-0`}
                      >
                        <ChevronDown aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit ${section.title}`}
                        onClick={() => setEditing(section.id)}
                        className={ADMIN_BUTTON}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Remove ${section.title}`}
                        onClick={() => run(() => deleteDeliverableAction(section.id))}
                        className={ADMIN_DANGER}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          {editing === "new" ? (
            <SectionForm
              orderId={orderId}
              section={null}
              sortOrder={nextSort}
              onDone={() => setEditing(null)}
            />
          ) : (
            <button type="button" onClick={() => setEditing("new")} className={ADMIN_BUTTON}>
              Add section
            </button>
          )}
        </div>
      </div>

      <div>
        <AttachmentUploader orderId={orderId} pendingRows={pendingUploads} />
        {ready.length > 0 && (
          <ul role="list" className={`mt-3 ${RULED}`}>
            {ready.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-2 py-2">
                <a
                  href={`/api/orders/${orderId}/files/${file.id}`}
                  className="inline-flex min-h-11 min-w-0 flex-1 items-center break-all text-sm font-semibold text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {file.file_name ?? file.title}
                </a>
                <StatusChip
                  chip={
                    file.status === "published"
                      ? { word: "Published", tone: "positive" }
                      : { word: "Draft", tone: "muted" }
                  }
                />
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Remove ${file.file_name ?? file.title}`}
                  onClick={() => run(() => deleteDeliverableAction(file.id))}
                  className={ADMIN_DANGER}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sections.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            Preview what the customer sees
          </summary>
          <div className="mt-2 space-y-6 rounded-card border border-line bg-base/30 p-4">
            {sections.map((section) => (
              <div key={section.id}>
                <h3 className="text-base font-bold text-ink">{section.title}</h3>
                <div className="mt-1">
                  <RichTextView text={section.body ?? ""} headingLevel={4} />
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        {disputeOpen && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-brand-cyan"
            />
            I understand a chargeback is open on this order
          </label>
        )}
        {everDelivered && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-brand-cyan"
            />
            Email the customer about this update
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canPublish || pending}
            aria-describedby={publishReason ? "publish-reason" : undefined}
            onClick={() =>
              run(() =>
                publishDeliveryAction(orderId, { acknowledgeChargeback: acknowledged, notify }),
              )
            }
            className={`${ADMIN_PRIMARY} w-full sm:w-auto`}
          >
            {pending ? "Publishing..." : everDelivered ? "Save changes" : "Publish and mark delivered"}
          </button>
          {delivered && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resendDeliveryEmailAction(orderId))}
              className={ADMIN_BUTTON}
            >
              Re-send the delivery email
            </button>
          )}
        </div>
        {publishReason && (
          <p id="publish-reason" className="text-xs text-ink-muted">
            {publishReason}
          </p>
        )}
        <ActionStatus status={status} failed={failed} />
      </div>
    </div>
  );
}
