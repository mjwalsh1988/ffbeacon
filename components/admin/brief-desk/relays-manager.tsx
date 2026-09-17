"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editRelay, hideRelay, retractRelay, unhideRelay } from "@/app/admin/brief-desk/actions";
import type { GroundingFailure } from "@/lib/relays/grounding";
import {
  RELAY_FACT_LABEL_MAX,
  RELAY_FACT_VALUE_MAX,
  RELAY_HEADLINE_MAX,
  RELAY_HEADLINE_MIN,
  RELAY_KIND_LABELS,
  RELAY_MAX_FACTS,
  isRelayKind,
  type RelayFact,
} from "@/lib/relays/types";
import { formatEastern } from "@/lib/datetime";

export interface RelayAdminRow {
  id: string;
  slug: string;
  headline: string;
  kind: string;
  season: string;
  week: number | null;
  status: string;
  statusReason: string | null;
  sourceHandle: string;
  sourceUrl: string;
  sourcePostedAt: string;
  facts: RelayFact[];
  timeline: string | null;
  briefId: string | null;
  updatedAt: string;
}

type Status = { msg: string; error: boolean } | null;
type Panel = "hide" | "retract" | "edit" | null;

const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50";
const inputClass =
  "min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const areaClass =
  "w-full rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";

function statusLabel(status: string): string {
  if (status === "published") return "Published";
  if (status === "hidden") return "Hidden";
  if (status === "retracted") return "Retracted";
  return status;
}

function weekLabel(week: number | null, season: string): string {
  if (week === null) return `${season}, week unassigned`;
  if (week === 0) return `${season} off-season`;
  return `${season} week ${week}`;
}

function FailureList({ failures }: { failures: GroundingFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="mt-2 rounded-card border border-signal-warning/60 bg-signal-warning/10 p-3">
      <p className="text-sm font-medium text-ink">
        Still hidden: {failures.length} {failures.length === 1 ? "token" : "tokens"} the source post does not contain.
      </p>
      <ul role="list" className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
        {failures.map((f, i) => (
          <li key={i}>
            &quot;{f.token}&quot; ({f.check} check, in the {f.where})
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReasonPanel({
  relayId,
  panelId,
  action,
  verb,
  onDone,
  onCancel,
}: {
  relayId: string;
  panelId: string;
  action: (id: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  verb: "Hide" | "Retract";
  onDone: (res: { ok: boolean; error?: string }, okMsg: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  // The panel appears after the button row, so opening it without moving focus
  // leaves a keyboard reader tabbing past the remaining buttons to reach it.
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <form
      id={panelId}
      className="mt-3 space-y-2 rounded-card border border-line bg-base/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) {
          setError(`A reason is required to ${verb.toLowerCase()} a Relay.`);
          ref.current?.focus();
          return;
        }
        setError(null);
        startTransition(async () => {
          const res = await action(relayId, reason);
          onDone(res, verb === "Hide" ? "Hidden." : "Retracted. The Discord card is being patched.");
        });
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        Reason to {verb.toLowerCase()} (required)
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={2}
        required
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={areaClass}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          if (error && e.target.value.trim()) setError(null);
        }}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-signal-danger">
          {error}
        </p>
      ) : null}
      {verb === "Retract" ? (
        <p className="text-xs text-ink-subtle">
          A retraction is permanent. The Discord card is edited to say so, and if a published Brief cites this Relay a correction row opens against it.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${btnClass} hover:border-signal-danger`} disabled={pending}>
          {verb === "Retract" ? "Confirm retract" : "Confirm hide"}
        </button>
        <button type="button" className={btnClass} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditPanel({
  relay,
  panelId,
  onDone,
  onCancel,
}: {
  relay: RelayAdminRow;
  panelId: string;
  onDone: (res: { ok: boolean; error?: string }, okMsg: string, failures: GroundingFailure[]) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const headlineRef = useRef<HTMLTextAreaElement>(null);
  const [headline, setHeadline] = useState(relay.headline);
  const [facts, setFacts] = useState<RelayFact[]>(() => {
    const list = relay.facts.slice(0, RELAY_MAX_FACTS);
    while (list.length < RELAY_MAX_FACTS) list.push({ label: "", value: "" });
    return list;
  });
  const [timeline, setTimeline] = useState(relay.timeline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<GroundingFailure[]>([]);
  const [pending, startTransition] = useTransition();

  const setFact = (i: number, patch: Partial<RelayFact>) =>
    setFacts((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  // Same reason as ReasonPanel: the form opens below the buttons that opened it.
  useEffect(() => {
    headlineRef.current?.focus();
  }, []);

  return (
    <form
      id={panelId}
      className="mt-3 space-y-3 rounded-card border border-line bg-base/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const h = headline.trim();
        if (h.length < RELAY_HEADLINE_MIN) {
          setError(`The headline must be at least ${RELAY_HEADLINE_MIN} characters.`);
          return;
        }
        setError(null);
        startTransition(async () => {
          const res = await editRelay(relay.id, {
            headline: h,
            facts: facts.map((f) => ({ label: f.label.trim(), value: f.value.trim() })).filter((f) => f.label && f.value),
            timeline: timeline.trim() || null,
          });
          setFailures(res.failures);
          if (!res.ok) {
            onDone({ ok: false, error: res.error }, "", res.failures);
            return;
          }
          onDone(
            { ok: true },
            res.status === "published"
              ? "Saved. The Relay grounds against its source post and is published."
              : `Saved, but it stays hidden: ${res.failures.length} ${res.failures.length === 1 ? "token is" : "tokens are"} not in the source post.`,
            res.failures,
          );
        });
      }}
    >
      <label htmlFor={`${id}-h`} className="block text-sm font-medium text-ink">
        Headline ({RELAY_HEADLINE_MIN} to {RELAY_HEADLINE_MAX} characters)
      </label>
      <textarea
        id={`${id}-h`}
        ref={headlineRef}
        rows={2}
        maxLength={RELAY_HEADLINE_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={areaClass}
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-signal-danger">
          {error}
        </p>
      ) : null}
      <fieldset>
        <legend className="text-sm font-medium text-ink">Facts, up to {RELAY_MAX_FACTS} label and value pairs. Leave a pair blank to drop it.</legend>
        <div className="mt-1 space-y-2">
          {facts.map((f, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
              <label className="block text-xs">
                <span className="mb-1 block text-ink-muted">Fact {i + 1} label</span>
                <input className={inputClass} maxLength={RELAY_FACT_LABEL_MAX} value={f.label} onChange={(e) => setFact(i, { label: e.target.value })} />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-ink-muted">Fact {i + 1} value</span>
                <input className={inputClass} maxLength={RELAY_FACT_VALUE_MAX} value={f.value} onChange={(e) => setFact(i, { value: e.target.value })} />
              </label>
            </div>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${id}-t`} className="block text-sm font-medium text-ink">
        Timeline (optional)
      </label>
      <input id={`${id}-t`} className={inputClass} value={timeline} onChange={(e) => setTimeline(e.target.value)} />
      <p className="text-xs text-ink-subtle">
        Every number and name must appear in the source post. Saving re-runs that check; a pass publishes the Relay and patches its Discord card, a miss keeps it hidden and lists what failed.
      </p>
      <FailureList failures={failures} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnClass} disabled={pending}>
          Save and publish if grounded
        </button>
        <button type="button" className={btnClass} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RelayRow({
  relay,
  pending,
  announce,
}: {
  relay: RelayAdminRow;
  pending: boolean;
  announce: (res: { ok: boolean; error?: string }, okMsg: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [lastFailures, setLastFailures] = useState<GroundingFailure[]>([]);
  const [unhiding, startUnhide] = useTransition();
  const retracted = relay.status === "retracted";
  const kindLabel = isRelayKind(relay.kind) ? RELAY_KIND_LABELS[relay.kind] : relay.kind;
  const rowId = useId();
  const panelId = `${rowId}-panel`;
  // Which button opened the panel, so Cancel hands focus back to it rather than
  // dropping it on <body> when the panel unmounts.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const togglePanel = (next: Exclude<Panel, null>, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setPanel((cur) => (cur === next ? null : next));
  };
  const cancelPanel = () => {
    setPanel(null);
    triggerRef.current?.focus();
  };

  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span
          className={`rounded-full border px-2 py-0.5 ${
            relay.status === "published"
              ? "border-brand-cyan text-brand-cyan"
              : relay.status === "hidden"
                ? "border-signal-warning text-signal-warning"
                : "border-signal-danger text-signal-danger"
          }`}
        >
          {statusLabel(relay.status)}
        </span>
        <span className="rounded-full border border-line px-2 py-0.5 text-ink-muted">{kindLabel}</span>
        <span className="text-ink-subtle">{weekLabel(relay.week, relay.season)}</span>
      </div>
      <p className="mt-2 font-medium text-ink">{relay.headline}</p>
      {relay.statusReason ? (
        <p className="mt-1 text-xs text-ink-muted">Status reason: {relay.statusReason}</p>
      ) : null}
      {relay.facts.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {relay.facts.map((f, i) => (
            <div key={i} className="contents">
              <dt className="text-ink-subtle">{f.label}</dt>
              <dd className="text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {relay.timeline ? <p className="mt-1 text-xs text-ink-muted">Timeline: {relay.timeline}</p> : null}
      <p className="mt-2 text-xs text-ink-subtle">
        Original report: @{relay.sourceHandle.replace(/^@/, "")} on X, {formatEastern(relay.sourcePostedAt)}.
        {relay.briefId ? " Cited by a published Brief." : ""}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <a
          href={`/brief/relay/${relay.slug}`}
          className="inline-flex min-h-[44px] items-center font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        >
          Permalink: {relay.headline}
        </a>
        {relay.sourceUrl ? (
          <a
            href={relay.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            Source post on X<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </p>

      <FailureList failures={panel === "edit" ? [] : lastFailures} />

      {retracted ? (
        <p className="mt-3 text-sm text-ink-muted">A retracted Relay stays retracted and cannot be edited.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {relay.status === "published" ? (
            <button
              type="button"
              className={btnClass}
              disabled={pending}
              aria-expanded={panel === "hide"}
              aria-controls={panel === "hide" ? panelId : undefined}
              onClick={(e) => togglePanel("hide", e.currentTarget)}
            >
              Hide
            </button>
          ) : (
            <button
              type="button"
              className={btnClass}
              disabled={pending || unhiding}
              onClick={() =>
                startUnhide(async () => {
                  const res = await unhideRelay(relay.id);
                  announce(res, "Unhidden and published.");
                })
              }
            >
              Unhide
            </button>
          )}
          <button
            type="button"
            className={`${btnClass} hover:border-signal-danger`}
            disabled={pending}
            aria-expanded={panel === "retract"}
            aria-controls={panel === "retract" ? panelId : undefined}
            onClick={(e) => togglePanel("retract", e.currentTarget)}
          >
            Retract
          </button>
          <button
            type="button"
            className={btnClass}
            disabled={pending}
            aria-expanded={panel === "edit"}
            aria-controls={panel === "edit" ? panelId : undefined}
            onClick={(e) => togglePanel("edit", e.currentTarget)}
          >
            Edit
          </button>
        </div>
      )}

      {panel === "hide" ? (
        <ReasonPanel
          relayId={relay.id}
          panelId={panelId}
          verb="Hide"
          action={hideRelay}
          onDone={(res, okMsg) => {
            announce(res, okMsg);
            if (res.ok) setPanel(null);
          }}
          onCancel={cancelPanel}
        />
      ) : null}
      {panel === "retract" ? (
        <ReasonPanel
          relayId={relay.id}
          panelId={panelId}
          verb="Retract"
          action={retractRelay}
          onDone={(res, okMsg) => {
            announce(res, okMsg);
            if (res.ok) setPanel(null);
          }}
          onCancel={cancelPanel}
        />
      ) : null}
      {panel === "edit" ? (
        <EditPanel
          relay={relay}
          panelId={panelId}
          onDone={(res, okMsg, failures) => {
            setLastFailures(failures);
            announce(res, okMsg);
            if (res.ok && failures.length === 0) setPanel(null);
          }}
          onCancel={cancelPanel}
        />
      ) : null}
    </li>
  );
}

export function RelaysManager({ relays }: { relays: RelayAdminRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);

  const announce = (res: { ok: boolean; error?: string }, okMsg: string) => {
    setStatus(res.ok ? { msg: okMsg, error: false } : { msg: `Failed: ${res.error ?? "unknown error"}`, error: true });
    resultRef.current?.focus();
    if (res.ok) router.refresh();
  };

  return (
    <div className="space-y-4">
      <p
        ref={resultRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={`min-h-[1.25rem] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan ${status?.error ? "text-signal-danger" : "text-ink-muted"}`}
      >
        {status ? status.msg : ""}
      </p>
      {relays.length === 0 ? null : (
        <ul role="list" className="space-y-3">
          {relays.map((r) => (
            <RelayRow key={r.id} relay={r} pending={false} announce={announce} />
          ))}
        </ul>
      )}
    </div>
  );
}
