"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  approveBriefEdition,
  archiveBriefEdition,
  rejectBriefEdition,
  saveEditionReviewTicks,
  saveEditionText,
} from "@/app/admin/brief-desk/actions";
import { ArticleMarkdown } from "@/components/beacon-brief/article-markdown";
import { researchTick, warningTick } from "@/lib/brief-desk/review-ticks";
import type { Draft, DraftBlock, DraftSection, ValidationReport } from "@/lib/brief-desk/types";
import type { RelayFact } from "@/lib/relays/types";
import { formatEastern } from "@/lib/datetime";

export interface CitedRelay {
  id: string;
  slug: string;
  headline: string;
  kind: string;
  facts: RelayFact[];
  timeline: string | null;
  status: string;
  sourceHandle: string;
  sourcePostedAt: string;
}

export interface ResearchRow {
  claim: string;
  url: string;
  fetchedAt: string;
  note: string;
  kind: "check" | "keywords";
}

type Status = { msg: string; error: boolean } | null;
type RunFn = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => void;

const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50";
const areaClass =
  "w-full rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const checkClass = "h-5 w-5 shrink-0 accent-brand-cyan";
const h2Class = "text-lg font-semibold tracking-tight text-ink";

const ROUTINES_URL = "https://claude.ai/code/routines";

function fetchedLabel(raw: string): string {
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? raw : formatEastern(raw);
}

/**
 * A checkbox whose tick is one line in review_notes, saved as it changes.
 *
 * Only `children` goes inside the <label>, so the checkbox's accessible name is
 * the one line the tick is about. `note` is a sibling wired up with
 * aria-describedby, and `detail` is a sibling with no association at all, which
 * is where a link belongs: an anchor inside a label sits in the label's own
 * activation region, and browsers disagree about where that click lands.
 */
function TickBox({
  tick,
  checked,
  onToggle,
  pending,
  children,
  note,
  detail,
}: {
  tick: string;
  checked: boolean;
  onToggle: (tick: string, next: boolean) => void;
  pending: boolean;
  children: ReactNode;
  note?: ReactNode;
  detail?: ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className="flex min-h-[44px] items-start gap-3 py-2">
      <input
        id={id}
        type="checkbox"
        className={`${checkClass} mt-0.5`}
        // Not disabled while a save is in flight: the save runs in the
        // component's one transition, so disabling every checkbox disabled the
        // focused one too, and Chrome then dropped focus to the body once per
        // tick. The save is a set replacement (last write wins), so a second
        // tick during the first is safe. `pending` is reported on the
        // fieldset as aria-busy instead.
        checked={checked}
        aria-describedby={note ? noteId : undefined}
        onChange={(e) => onToggle(tick, e.target.checked)}
      />
      <div className="text-sm text-ink">
        <label htmlFor={id} className="block">
          {children}
        </label>
        {note ? (
          <span id={noteId} className="mt-0.5 block text-xs text-ink-subtle">
            {note}
          </span>
        ) : null}
        {detail}
      </div>
    </div>
  );
}

function RelayDisclosure({ relayId, relay }: { relayId: string; relay: CitedRelay | undefined }) {
  if (!relay) {
    return (
      <li className="text-sm text-signal-warning">
        Relay {relayId} is cited but no longer exists in the relays table.
      </li>
    );
  }
  return (
    <li>
      <details className="rounded-card border border-line bg-base/60">
        <summary className="min-h-[44px] cursor-pointer px-3 py-2 text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan">
          {relay.headline}
          {relay.status !== "published" ? ` (${relay.status})` : ""}
        </summary>
        <div className="px-3 pb-3 text-sm text-ink-muted">
          <p className="text-xs text-ink-subtle">
            Kind: {relay.kind}. Status: {relay.status}. Original report: @{relay.sourceHandle.replace(/^@/, "")} on X,{" "}
            {formatEastern(relay.sourcePostedAt)}.
          </p>
          {relay.facts.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {relay.facts.map((f, i) => (
                <div key={i} className="contents">
                  <dt className="text-ink-subtle">{f.label}</dt>
                  <dd className="text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-xs text-ink-subtle">No facts on this Relay.</p>
          )}
          {relay.timeline ? <p className="mt-2">Timeline: {relay.timeline}</p> : null}
          <p className="mt-2">
            <a
              href={`/brief/relay/${relay.slug}`}
              className="font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
            >
              Permalink: {relay.headline}
            </a>
          </p>
        </div>
      </details>
    </li>
  );
}

function BlockCard({
  block,
  editable,
  pending,
  run,
  editionId,
}: {
  block: DraftBlock;
  editable: boolean;
  pending: boolean;
  run: RunFn;
  editionId: string;
}) {
  const id = useId();
  const [caption, setCaption] = useState(block.caption);
  const [conclusion, setConclusion] = useState(block.conclusion);
  const dirty = caption !== block.caption || conclusion !== block.conclusion;
  return (
    <li className="rounded-card border border-line bg-base/60 p-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-subtle">Block</dt>
        <dd className="font-mono text-ink">{block.id}</dd>
        <dt className="text-ink-subtle">Kind</dt>
        <dd className="text-ink">{block.kind}</dd>
        <dt className="text-ink-subtle">Dataset</dt>
        <dd className="text-ink">{block.dataset_id ?? "none"}</dd>
        <dt className="text-ink-subtle">Caption</dt>
        <dd className="text-ink">{block.caption || "(empty)"}</dd>
        <dt className="text-ink-subtle">Conclusion</dt>
        <dd className="text-ink">{block.conclusion || "(empty)"}</dd>
      </dl>
      {editable ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveEditionText(editionId, { blocks: { [block.id]: { caption, conclusion } } }),
              `Saved the caption and conclusion for block ${block.id}.`,
            );
          }}
        >
          <label htmlFor={`${id}-cap`} className="block text-xs font-medium text-ink">
            Caption for block {block.id}
          </label>
          <textarea id={`${id}-cap`} rows={2} maxLength={300} className={areaClass} value={caption} onChange={(e) => setCaption(e.target.value)} />
          <label htmlFor={`${id}-con`} className="block text-xs font-medium text-ink">
            Conclusion for block {block.id}
          </label>
          <textarea id={`${id}-con`} rows={2} maxLength={300} className={areaClass} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
          <p className="text-xs text-ink-subtle">The data is not editable. If the numbers are wrong, reject the edition with that note.</p>
          <button type="submit" className={btnClass} disabled={pending || !dirty}>
            Save block {block.id}
          </button>
        </form>
      ) : null}
    </li>
  );
}

function SectionView({
  section,
  blocks,
  relays,
  editable,
  pending,
  run,
  editionId,
}: {
  section: DraftSection;
  blocks: DraftBlock[];
  relays: Record<string, CitedRelay>;
  editable: boolean;
  pending: boolean;
  run: RunFn;
  editionId: string;
}) {
  const id = useId();
  const [body, setBody] = useState(section.body_md);
  const dirty = body !== section.body_md;
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-card border border-line bg-surface/60 p-4">
      {section.eyebrow ? <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">{section.eyebrow}</p> : null}
      <h3 id={`${id}-h`} className="mt-1 text-xl font-semibold tracking-tight text-ink">
        {section.heading}
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        Section id {section.id}. Icon: {section.icon || "none"}.
      </p>
      <ArticleMarkdown content={section.body_md} />

      {section.relay_ids.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Relays cited ({section.relay_ids.length})</h4>
          <ul role="list" className="mt-2 space-y-2">
            {section.relay_ids.map((rid) => (
              <RelayDisclosure key={rid} relayId={rid} relay={relays[rid]} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-subtle">No Relays cited in this section.</p>
      )}

      {section.citations.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Citations ({section.citations.length})</h4>
          <ul role="list" className="mt-2 space-y-1 text-sm text-ink-muted">
            {section.citations.map((c, i) => (
              <li key={i}>
                {c.claim}{" "}
                <a
                  href={c.url}
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                  className="font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                >
                  {c.url}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blocks.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Blocks in this section ({blocks.length})</h4>
          <ul role="list" className="mt-2 space-y-2">
            {blocks.map((b) => (
              <BlockCard key={b.id} block={b} editable={editable} pending={pending} run={run} editionId={editionId} />
            ))}
          </ul>
        </div>
      ) : null}

      {editable ? (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveEditionText(editionId, { sections: { [section.id]: body } }),
              `Saved the body of ${section.heading}.`,
            );
          }}
        >
          <label htmlFor={`${id}-body`} className="block text-sm font-medium text-ink">
            Body of {section.heading} (markdown)
          </label>
          <textarea id={`${id}-body`} rows={10} className={`${areaClass} font-mono`} value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="submit" className={btnClass} disabled={pending || !dirty}>
            Save {section.heading}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function HeadEditor({
  draft,
  pending,
  run,
  editionId,
}: {
  draft: Draft;
  pending: boolean;
  run: RunFn;
  editionId: string;
}) {
  const id = useId();
  const [title, setTitle] = useState(draft.title);
  const [meta, setMeta] = useState(draft.meta_description);
  const [tlDr, setTlDr] = useState(draft.tl_dr);
  const dirty = title !== draft.title || meta !== draft.meta_description || tlDr !== draft.tl_dr;
  return (
    <form
      className="space-y-2 rounded-card border border-line bg-surface/60 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveEditionText(editionId, { title, meta_description: meta, tl_dr: tlDr }),
          "Saved the title, meta description and summary.",
        );
      }}
    >
      <h3 className="text-sm font-semibold text-ink">Edit the title, meta description and summary</h3>
      <label htmlFor={`${id}-title`} className="block text-xs font-medium text-ink">
        Title (40 to 110 characters)
      </label>
      <textarea id={`${id}-title`} rows={2} maxLength={110} className={areaClass} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor={`${id}-meta`} className="block text-xs font-medium text-ink">
        Meta description (80 to 165 characters)
      </label>
      <textarea id={`${id}-meta`} rows={3} maxLength={165} className={areaClass} value={meta} onChange={(e) => setMeta(e.target.value)} />
      <label htmlFor={`${id}-tldr`} className="block text-xs font-medium text-ink">
        Summary, the tl;dr (120 to 1500 characters)
      </label>
      <textarea id={`${id}-tldr`} rows={5} maxLength={1500} className={areaClass} value={tlDr} onChange={(e) => setTlDr(e.target.value)} />
      <button type="submit" className={btnClass} disabled={pending || !dirty}>
        Save title and summary
      </button>
    </form>
  );
}

export function EditionReview({
  editionId,
  status,
  slug,
  draft,
  draftError,
  validation,
  researchLog,
  relays,
  ticks,
  reviewerNotes,
  discordDefault,
}: {
  editionId: string;
  status: string;
  slug: string;
  draft: Draft | null;
  draftError: string | null;
  validation: ValidationReport;
  researchLog: ResearchRow[];
  relays: Record<string, CitedRelay>;
  ticks: string[];
  reviewerNotes: string[];
  discordDefault: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Status>(null);
  const [tickSet, setTickSet] = useState<Set<string>>(() => new Set(ticks));
  const [postToDiscord, setPostToDiscord] = useState(discordDefault);
  const [titleChoice, setTitleChoice] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const rejectRef = useRef<HTMLTextAreaElement>(null);
  /** The first title radio, so the "pick a title" error can take focus. */
  const titleRef = useRef<HTMLInputElement>(null);

  const inReview = status === "in_review";
  const editable = draft !== null && (inReview || status === "published");
  const titleOptions = draft?.title_options ?? [];
  const needsTitle = inReview && titleOptions.length > 0;

  const run: RunFn = (fn, okMsg) =>
    startTransition(async () => {
      setResult(null);
      const res = await fn();
      setResult(res.ok ? { msg: okMsg, error: false } : { msg: `Failed: ${res.error ?? "unknown error"}`, error: true });
      resultRef.current?.focus();
      if (res.ok) router.refresh();
    });

  const toggleTick = (tick: string, next: boolean) => {
    const updated = new Set(tickSet);
    if (next) updated.add(tick);
    else updated.delete(tick);
    setTickSet(updated);
    startTransition(async () => {
      const res = await saveEditionReviewTicks(editionId, [...updated]);
      if (!res.ok) {
        setResult({ msg: `Failed to save the tick: ${res.error}`, error: true });
        resultRef.current?.focus();
      }
    });
  };

  const blocksById = new Map((draft?.blocks ?? []).map((b) => [b.id, b]));
  const referenced = new Set((draft?.sections ?? []).flatMap((s) => s.block_refs));
  const unreferencedBlocks = (draft?.blocks ?? []).filter((b) => !referenced.has(b.id));

  return (
    <div className="space-y-8">
      <p
        ref={resultRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={`min-h-[1.25rem] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan ${result?.error ? "text-signal-danger" : "text-ink-muted"}`}
      >
        {result ? result.msg : ""}
      </p>

      {status === "published" ? (
        <p className="text-sm text-ink-muted">
          This edition is live at{" "}
          <a href={`/brief/${slug}`} className="font-semibold text-brand-cyan underline">
            /brief/{slug}
          </a>
          . Edits below save straight to the published page.
        </p>
      ) : null}

      {reviewerNotes.length > 0 ? (
        <section aria-labelledby={`${ids}-notes`} className="rounded-card border border-line bg-surface/60 p-4">
          <h2 id={`${ids}-notes`} className={h2Class}>
            Reviewer notes on record
          </h2>
          <ul role="list" className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {reviewerNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 1. The validation report */}
      <section aria-labelledby={`${ids}-val`} className="rounded-card border border-line bg-surface/60 p-4">
        <h2 id={`${ids}-val`} className={h2Class}>
          Validation report
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {validation.word_count} words at validation. {validation.warnings.length}{" "}
          {validation.warnings.length === 1 ? "warning" : "warnings"}, {validation.errors.length}{" "}
          {validation.errors.length === 1 ? "error" : "errors"}.
        </p>
        {validation.errors.length > 0 ? (
          <ul role="list" className="mt-2 list-disc space-y-1 pl-5 text-sm text-signal-danger">
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        {validation.warnings.length > 0 ? (
          <fieldset className="mt-3" aria-busy={pending || undefined}>
            <legend className="text-sm font-medium text-ink">Warnings. Tick each one once you have looked at it; the tick is your own record and does not block approval.</legend>
            <div className="divide-y divide-line">
              {validation.warnings.map((w, i) => (
                <TickBox key={i} tick={warningTick(w)} checked={tickSet.has(warningTick(w))} onToggle={toggleTick} pending={pending}>
                  {w}
                </TickBox>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">No warnings.</p>
        )}
      </section>

      {/* 2. The research log */}
      <section aria-labelledby={`${ids}-log`} className="rounded-card border border-line bg-surface/60 p-4">
        <h2 id={`${ids}-log`} className={h2Class}>
          Research log ({researchLog.length})
        </h2>
        {researchLog.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">The run recorded no research fetches.</p>
        ) : (
          <fieldset className="mt-2" aria-busy={pending || undefined}>
            <legend className="text-sm text-ink-muted">Each row is a claim the run checked and the page it read. Tick a row after reading the source yourself. Approval is allowed with unticked rows.</legend>
            <div className="divide-y divide-line">
              {researchLog.map((r, i) => (
                <TickBox
                  key={i}
                  tick={researchTick(r.url)}
                  checked={tickSet.has(researchTick(r.url))}
                  onToggle={toggleTick}
                  pending={pending}
                  note={
                    <>
                      {r.kind === "keywords" ? "Keyword check. " : ""}Fetched {fetchedLabel(r.fetchedAt)}.
                      {r.note ? ` Note: ${r.note}` : ""}
                    </>
                  }
                  detail={
                    <a
                      href={r.url}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="mt-1 inline-block break-all text-xs font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                    >
                      {r.url}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  }
                >
                  <span className="font-medium">{r.claim}</span>
                </TickBox>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      {/* 3 and 4. The draft, rendered, with the editors beneath each part */}
      {draft ? (
        <section aria-labelledby={`${ids}-draft`} className="space-y-4">
          <h2 id={`${ids}-draft`} className={h2Class}>
            The draft
          </h2>
          <div className="rounded-card border border-line bg-surface/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">Title</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{draft.title}</p>
            <p className="mt-1 font-mono text-xs text-ink-subtle">/brief/{draft.slug}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-cyan">Meta description</p>
            <p className="mt-1 text-sm text-ink-muted">{draft.meta_description}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-cyan">Summary</p>
            <p className="mt-1 text-sm text-ink">{draft.tl_dr}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-cyan">Format note</p>
            <p className="mt-1 text-sm text-ink-muted">{draft.format_note}</p>
          </div>
          {editable ? <HeadEditor draft={draft} pending={pending} run={run} editionId={editionId} /> : null}

          {draft.sections.map((s) => (
            <SectionView
              key={s.id}
              section={s}
              blocks={s.block_refs.map((ref) => blocksById.get(ref)).filter((b): b is DraftBlock => Boolean(b))}
              relays={relays}
              editable={editable}
              pending={pending}
              run={run}
              editionId={editionId}
            />
          ))}

          {unreferencedBlocks.length > 0 ? (
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <h3 className="text-sm font-semibold text-ink">Blocks no section references ({unreferencedBlocks.length})</h3>
              <ul role="list" className="mt-2 space-y-2">
                {unreferencedBlocks.map((b) => (
                  <BlockCard key={b.id} block={b} editable={editable} pending={pending} run={run} editionId={editionId} />
                ))}
              </ul>
            </div>
          ) : null}

          {draft.faq.length > 0 ? (
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <h3 className="text-xl font-semibold tracking-tight text-ink">Questions people ask</h3>
              <dl className="mt-2 space-y-3">
                {draft.faq.map((f, i) => (
                  <div key={i}>
                    <dt className="font-medium text-ink">{f.question}</dt>
                    <dd>
                      <ArticleMarkdown content={f.answer_md} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby={`${ids}-broken`} className="rounded-card border border-signal-danger/60 bg-signal-danger/10 p-4">
          <h2 id={`${ids}-broken`} className={h2Class}>
            The stored draft does not parse
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{draftError}</p>
          <p className="mt-1 text-sm text-ink-muted">It cannot be approved. Reject it with a note and the next run redrafts.</p>
        </section>
      )}

      {/* 5. Actions */}
      <section aria-labelledby={`${ids}-actions`} className="space-y-4">
        <h2 id={`${ids}-actions`} className={h2Class}>
          Actions
        </h2>

        {inReview && draft ? (
          <form
            className="space-y-3 rounded-card border border-line bg-surface/60 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (needsTitle && titleChoice === null) {
                setTitleError("Pick one of the three titles before approving.");
                titleRef.current?.focus();
                return;
              }
              setTitleError(null);
              run(
                () => approveBriefEdition(editionId, { postToDiscord, titleChoice: needsTitle ? titleChoice : null }),
                `Approved and published${postToDiscord ? ", and the Discord post is queued" : ""}.`,
              );
            }}
          >
            <h3 className="text-sm font-semibold text-ink">Approve and publish</h3>
            {/* aria-required is ignored on a fieldset (a group role), so the
                requirement sits on the radios themselves, where the platform
                reports it. */}
            {needsTitle ? (
              <fieldset aria-describedby={titleError ? `${ids}-title-err` : undefined}>
                <legend className="text-sm font-medium text-ink">Title for this off-season edition (required)</legend>
                <div className="mt-1 space-y-1">
                  {titleOptions.map((t, i) => (
                    <label key={i} className="flex min-h-[44px] items-start gap-3 py-2 text-sm text-ink">
                      <input
                        ref={i === 0 ? titleRef : undefined}
                        type="radio"
                        name="title-choice"
                        required
                        className={`${checkClass} mt-0.5`}
                        checked={titleChoice === i}
                        onChange={() => {
                          setTitleChoice(i);
                          setTitleError(null);
                        }}
                      />
                      <span>
                        <span className="block font-medium">{t.title}</span>
                        <span className="block font-mono text-xs text-ink-subtle">/brief/{t.slug}</span>
                        <span className="block text-xs text-ink-muted">{t.rationale}</span>
                        <span className="block text-xs text-ink-subtle">Target queries: {t.target_queries.join(", ")}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {titleError ? (
                  <p id={`${ids}-title-err`} role="alert" className="mt-1 text-sm text-signal-danger">
                    {titleError}
                  </p>
                ) : null}
              </fieldset>
            ) : null}
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
              <input type="checkbox" className={checkClass} checked={postToDiscord} onChange={(e) => setPostToDiscord(e.target.checked)} />
              Post to Discord with an everyone mention and the link
              {discordDefault ? "" : " (Discord posting is off in Settings; ticking this still queues the post)"}
            </label>
            <p className="text-sm text-ink-muted">
              Approving publishes this edition under the byline &quot;By Michael Walsh, founder of FF Beacon&quot;. It means you have read the draft and stand behind it as the author. There is no bulk approve.
            </p>
            <button type="submit" className={btnClass} disabled={pending}>
              Approve and publish
            </button>
          </form>
        ) : null}

        {inReview ? (
          <form
            className="space-y-3 rounded-card border border-line bg-surface/60 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rejectNotes.trim()) {
                setRejectError("Rejection notes are required; the next draft reads them.");
                rejectRef.current?.focus();
                return;
              }
              setRejectError(null);
              run(() => rejectBriefEdition(editionId, rejectNotes), "Rejected. The period reopens and the next run carries your notes.");
            }}
          >
            <h3 className="text-sm font-semibold text-ink">Reject with notes</h3>
            <label htmlFor={`${ids}-reject`} className="block text-sm font-medium text-ink">
              Notes for the next draft (required)
            </label>
            <textarea
              id={`${ids}-reject`}
              ref={rejectRef}
              rows={4}
              required
              aria-required="true"
              aria-invalid={rejectError ? true : undefined}
              aria-describedby={rejectError ? `${ids}-reject-err` : `${ids}-reject-hint`}
              className={areaClass}
              value={rejectNotes}
              onChange={(e) => {
                setRejectNotes(e.target.value);
                if (rejectError && e.target.value.trim()) setRejectError(null);
              }}
            />
            <p id={`${ids}-reject-hint`} className="text-xs text-ink-subtle">
              The next bundle for this period carries these notes and the rejected draft, and the run revises rather than starting over.
            </p>
            {rejectError ? (
              <p id={`${ids}-reject-err`} role="alert" className="text-sm text-signal-danger">
                {rejectError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={`${btnClass} hover:border-signal-danger`} disabled={pending}>
                Reject with notes
              </button>
              <a
                href={ROUTINES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Run the routine now
                <span className="sr-only"> (opens claude.ai in a new tab)</span>
              </a>
            </div>
          </form>
        ) : null}

        {status === "rejected" ? (
          <div className="space-y-3 rounded-card border border-line bg-surface/60 p-4">
            <h3 className="text-sm font-semibold text-ink">Archive</h3>
            <p className="text-sm text-ink-muted">This edition was rejected. Archiving takes it out of the list; the period stays open for the next draft either way.</p>
            <button
              type="button"
              className={btnClass}
              disabled={pending}
              onClick={() => run(() => archiveBriefEdition(editionId), "Archived.")}
            >
              Archive this edition
            </button>
          </div>
        ) : null}

        {!inReview && status !== "rejected" ? (
          <p className="text-sm text-ink-muted">
            No approval actions apply to an edition with status {status.replace("_", " ")}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
