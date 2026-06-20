"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  HelpCircle,
  MessageCirclePlus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  GUIDE_SECTION_LABEL,
  type GuideEntry,
  type GuidePageContent,
} from "@/lib/guide/types";
import { SubmitQuestionForm } from "./submit-question-form";

/**
 * The Signal Guide panel. A page-scoped, searchable knowledge base with a second
 * pane for submitting a question when the answer isn't here.
 *
 * Layout: slides UP from the bottom on mobile and IN from the right on desktop,
 * reusing the focus-trap / Esc / scroll-lock / portal pattern established by
 * components/slide-up-dialog.tsx. The body is a two-pane horizontal track: the
 * guide pane (search + content + "ask the team" CTA) and the submit pane (the
 * question form). Clicking the CTA slides the guide pane LEFT out and the form
 * pane IN from the right; "Back" reverses it. The off-screen pane is `inert` so
 * keyboard focus and screen readers only ever reach the visible pane.
 */
export function GuidePanel({
  open,
  onClose,
  content,
}: {
  open: boolean;
  onClose: () => void;
  content: GuidePageContent;
}) {
  const labelId = useId();
  const descId = useId();
  const searchId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"guide" | "submit">("guide");
  // Debounced count announced to screen readers so fast typing doesn't flood the
  // live region with one message per keystroke.
  const [liveCount, setLiveCount] = useState("");

  useEffect(() => {
    if (!open) return;
    setMounted(true);
    const raf = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setEntered(true)),
    );
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      setQuery("");
      setView("guide");
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer focus until the panel is on-screen, then send it to the search box.
    const focusTimer = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 90);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
          // Skip anything inside the off-screen (inert) pane.
        ).filter((el) => !el.closest("[data-pane-inert='true']"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Only restore focus if the previously-focused element is still in the DOM.
      // A route change can unmount the launcher while the panel is open; focusing a
      // detached node would silently drop focus to <body>.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus?.();
      }
    };
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const matches = (e: GuideEntry) =>
    q.length === 0 ||
    e.heading.toLowerCase().includes(q) ||
    e.body.toLowerCase().includes(q);

  const questions = useMemo(
    () => content.questions.filter(matches),
    [content.questions, q],
  );
  const terms = useMemo(() => content.terms.filter(matches), [content.terms, q]);
  const resultCount = questions.length + terms.length;

  useEffect(() => {
    if (q.length === 0) {
      setLiveCount("");
      return;
    }
    const t = window.setTimeout(() => {
      setLiveCount(
        `${resultCount} ${resultCount === 1 ? "result" : "results"} for ${query.trim()}.`,
      );
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, resultCount, query]);

  const goToSubmit = () => setView("submit");
  const backToGuide = () => {
    setView("guide");
    window.setTimeout(() => ctaRef.current?.focus(), 320);
  };

  if (!mounted || !open) return null;

  const panelTransform = entered
    ? "translate-y-0 sm:translate-x-0"
    : "translate-y-full sm:translate-y-0 sm:translate-x-full";

  const onSubmitView = view === "submit";

  const portal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end"
    >
      <button
        type="button"
        aria-label="Close the Signal Guide by tapping outside it"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        className={`relative flex w-full max-w-2xl flex-col rounded-t-modal border border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out motion-reduce:transition-none sm:h-full sm:max-w-md sm:rounded-none sm:rounded-l-modal sm:border-y-0 sm:border-r-0 ${panelTransform}`}
        style={{ maxHeight: "85vh" }}
      >
        {/* Mobile drag handle (decorative). */}
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-beacon opacity-60" />
        </div>

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pb-4 pt-4">
          <div className="min-w-0">
            <p
              id={labelId}
              className="flex items-center gap-2 text-base font-semibold text-ink"
            >
              <HelpCircle aria-hidden="true" className="h-5 w-5 text-brand-cyan" />
              Signal Guide
            </p>
            <p id={descId} className="mt-1 text-sm text-ink-muted">
              Help and definitions for {content.page.title}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the Signal Guide"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {/* Two-pane sliding viewport */}
        <div className="relative flex-1 overflow-hidden">
          <div
            className={`flex h-full w-[200%] transition-transform duration-300 ease-out motion-reduce:transition-none ${
              onSubmitView ? "-translate-x-1/2" : "translate-x-0"
            }`}
          >
            {/* Pane 1: guide content */}
            <div
              data-pane-inert={onSubmitView ? "true" : undefined}
              inert={onSubmitView || undefined}
              className="flex h-full w-1/2 flex-col"
            >
              {/* Search */}
              <div className="shrink-0 border-b border-line px-5 py-3">
                <label htmlFor={searchId} className="sr-only">
                  Search this page&apos;s guide
                </label>
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    ref={searchRef}
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search questions and terms"
                    className="min-h-[44px] w-full rounded-card border border-line bg-base pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  />
                </div>
                <p aria-live="polite" className="sr-only">
                  {liveCount}
                </p>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                {resultCount === 0 ? (
                  <p className="rounded-card border border-line bg-surface/60 p-4 text-sm text-ink-muted">
                    No matches for {`"${query.trim()}"`}. Try a different word.
                  </p>
                ) : (
                  <div className="space-y-7">
                    <GuideSection
                      icon="question"
                      title={GUIDE_SECTION_LABEL.question}
                      entries={questions}
                    />
                    <GuideSection
                      icon="term"
                      title={GUIDE_SECTION_LABEL.term}
                      entries={terms}
                    />
                  </div>
                )}

                {/* "Didn't find it?" CTA */}
                <div className="mt-7 rounded-card border border-brand-purple/30 bg-gradient-to-br from-brand-purple/10 to-brand-cyan/10 p-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <MessageCirclePlus
                      aria-hidden="true"
                      className="h-4 w-4 text-brand-cyan"
                    />
                    Not finding what you&apos;re looking for?
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                    Send us your question and we&apos;ll get it added to the Signal knowledge
                    base.
                  </p>
                  <button
                    ref={ctaRef}
                    type="button"
                    onClick={goToSubmit}
                    className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <MessageCirclePlus aria-hidden="true" className="h-4 w-4" />
                    Submit a question
                  </button>
                </div>
              </div>
            </div>

            {/* Pane 2: submit form */}
            <div
              data-pane-inert={!onSubmitView ? "true" : undefined}
              inert={!onSubmitView || undefined}
              className="h-full w-1/2"
            >
              <SubmitQuestionForm
                pageKey={content.page.page_key}
                pageTitle={content.page.title}
                active={onSubmitView}
                onBack={backToGuide}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}

function GuideSection({
  icon,
  title,
  entries,
}: {
  icon: "question" | "term";
  title: string;
  entries: GuideEntry[];
}) {
  const headingId = useId();
  if (entries.length === 0) return null;
  const Icon = icon === "question" ? HelpCircle : Sparkles;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan"
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
        {title}
      </h2>
      <ul role="list" className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <GuideDisclosure entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GuideDisclosure({ entry }: { entry: GuideEntry }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="rounded-card border border-line bg-surface/60">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((p) => !p)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          style={{ minHeight: 44 }}
        >
          <span>{entry.heading}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-200 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>
      {/* grid-rows height animation: 0fr (collapsed) -> 1fr (expanded). */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            id={bodyId}
            aria-hidden={!open}
            inert={!open ? true : undefined}
            className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-ink-muted"
          >
            {entry.body}
          </div>
        </div>
      </div>
    </div>
  );
}
