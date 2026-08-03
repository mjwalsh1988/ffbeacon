"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Search, X, ArrowRight } from "lucide-react";
import { SEARCHABLE_TOOLS, type SearchableTool } from "@/lib/site";
import { PlayerHeadshot } from "@/components/player-headshot";
import { formatEasternDate } from "@/lib/datetime";

const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;
const MIN_QUERY_LENGTH = 2;

/* ---------- result shapes (mirror /api/search) ---------- */

interface PlayerResult {
  kind: "player";
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

interface ArticleResult {
  kind: "article";
  slug: string;
  title: string;
  tlDr: string | null;
  articleType: string;
  publishedAt: string | null;
}

interface ToolResult {
  kind: "tool";
  tool: SearchableTool;
}

type AnyResult = PlayerResult | ArticleResult | ToolResult;

function resultHref(r: AnyResult): string {
  switch (r.kind) {
    case "player":
      return `/players/${r.slug}`;
    case "article":
      return `/brief/${r.slug}`;
    case "tool":
      return r.tool.href;
  }
}

function resultKey(r: AnyResult): string {
  switch (r.kind) {
    case "player":
      return `player:${r.slug}`;
    case "article":
      return `article:${r.slug}`;
    case "tool":
      return `tool:${r.tool.href}`;
  }
}

/** Match the static tools list locally. Matches the label, description, or any
 * keyword so "trade" finds Signal Check and "waiver" finds the FAAB calculator. */
function matchTools(query: string): ToolResult[] {
  const q = query.toLowerCase();
  return SEARCHABLE_TOOLS.filter((t) => {
    const haystack = [t.label, t.description, ...t.keywords].join(" ").toLowerCase();
    return haystack.includes(q);
  }).map((tool) => ({ kind: "tool" as const, tool }));
}

export function SiteSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [articles, setArticles] = useState<ArticleResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const inputId = useId();
  const listboxId = useId();
  const statusId = useId();
  const titleId = useId();
  const hintId = useId();

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_QUERY_LENGTH;

  const tools = useMemo(
    () => (longEnough ? matchTools(trimmed) : []),
    [trimmed, longEnough],
  );

  // Display order: players, articles, tools. The flat list drives keyboard
  // navigation and must match the render order so Arrow keys track the eye.
  const flat: AnyResult[] = useMemo(
    () => [...players, ...articles, ...tools],
    [players, articles, tools],
  );

  // SSR-safe portal: document only exists after hydration.
  useEffect(() => setMounted(true), []);

  // Debounced fetch of DB-backed results (players + articles).
  useEffect(() => {
    if (!open) return;
    if (!longEnough) {
      setPlayers([]);
      setArticles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed });
        const res = await fetch(`/api/search?${params.toString()}`, {
          headers: FETCH_HEADERS,
        });
        const data = (await res.json()) as {
          players?: PlayerResult[];
          articles?: ArticleResult[];
        };
        if (!cancelled) {
          setPlayers(data.players ?? []);
          setArticles(data.articles ?? []);
        }
      } catch {
        if (!cancelled) {
          setPlayers([]);
          setArticles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, longEnough, open]);

  // Reset the active option whenever the result set changes so the highlight
  // never points past the end of the list.
  useEffect(() => {
    setActiveIdx(0);
  }, [flat.length]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setPlayers([]);
    setArticles([]);
    setActiveIdx(0);
  }, []);

  // Backstop: close on any completed route change. go() already closes on a
  // result selection, so this only catches the paths that bypass it (browser
  // back/forward while the palette is open, a navigation started elsewhere).
  // Without it the palette can outlive the page it was opened on, and because
  // the open state also holds body scroll locked, that reads as a frozen page
  // that only a refresh clears. The mobile menu and the Beacon Brief drawer
  // already do this; the palette was the one overlay that did not.
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    close();
  }, [pathname, close]);

  // Keyboard-open shortcut (Cmd/Ctrl+K), a widely-expected convention.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus management + focus trap while the dialog is open. Restores focus to
  // the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the input right away so the user can type immediately. The portal is
    // already mounted by the time this effect runs, so focus synchronously and
    // re-assert on the next frame as a fallback in case the first call is
    // interrupted by the layout shift from hiding body scroll.
    inputRef.current?.focus();
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.tabIndex !== -1);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open, close]);

  // Keyboard (Enter) navigation. There is no anchor click here, so navigate
  // programmatically, then close. Mouse clicks navigate through the result's
  // <Link> instead (see OptionRow) to avoid a duplicate navigation.
  function go(r: AnyResult) {
    router.push(resultHref(r));
    close();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (flat.length ? Math.min(flat.length - 1, i + 1) : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const active = flat[activeIdx];
      if (active) {
        e.preventDefault();
        go(active);
      }
    }
  }

  const hasResults = flat.length > 0;
  const statusText = !longEnough
    ? `Type at least ${MIN_QUERY_LENGTH} characters to search.`
    : loading
      ? "Searching"
      : `${flat.length} ${flat.length === 1 ? "result" : "results"} for "${trimmed}"`;

  // Section boundaries in the flat list, used to render group headings inline.
  const playersEnd = players.length;
  const articlesEnd = playersEnd + articles.length;

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Search players, articles, and tools"
        className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line bg-surface text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <Search aria-hidden="true" className="h-[18px] w-[18px]" />
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-0 z-[70] flex items-start justify-center p-4 sm:p-6"
          >
            {/* Click-away backdrop. Kept out of the tab order and the a11y tree
                because the visible X button and Escape already close the
                dialog, so this is a pointer-only convenience. */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={close}
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
            />
            <div
              ref={dialogRef}
              className="relative mt-[8vh] flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-modal border border-line bg-surface-elevated shadow-2xl shadow-black/60"
            >
              <h2 id={titleId} className="sr-only">
                Search FF Beacon
              </h2>

              {/* Search field row */}
              <div className="flex items-center gap-2 border-b border-line px-4">
                <Search
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-ink-subtle"
                />
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={hasResults}
                  aria-controls={listboxId}
                  aria-activedescendant={
                    hasResults ? optionId(activeIdx) : undefined
                  }
                  aria-describedby={hintId}
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search players, articles, and tools"
                  className="min-h-11 w-full bg-transparent py-3.5 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:outline-none"
                />
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close search"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>

              <p id={hintId} className="sr-only">
                Results appear as you type. Use the up and down arrow keys to move
                between results and press Enter to open the highlighted result, or
                select any result directly.
              </p>
              <p id={statusId} aria-live="polite" role="status" className="sr-only">
                {statusText}
              </p>

              {/* Results */}
              <div className="beacon-scroll min-h-0 flex-1 overflow-y-auto">
                {!longEnough ? (
                  <p className="px-4 py-6 text-sm text-ink-subtle">
                    Type at least {MIN_QUERY_LENGTH} characters to search players,
                    articles, and tools.
                  </p>
                ) : loading && !hasResults ? (
                  <p className="px-4 py-6 text-sm text-ink-subtle">Searching...</p>
                ) : !hasResults ? (
                  <p className="px-4 py-6 text-sm text-ink-subtle">
                    No matches for &quot;{trimmed}&quot;. Try a player name, an
                    article title, or a tool.
                  </p>
                ) : (
                  <ul id={listboxId} role="listbox" aria-label="Search results">
                    {/* Players */}
                    {players.length > 0 && (
                      <SectionHeading id={`${listboxId}-players`}>
                        Players
                      </SectionHeading>
                    )}
                    {players.map((p, i) => (
                      <PlayerOption
                        key={resultKey(p)}
                        id={optionId(i)}
                        result={p}
                        active={i === activeIdx}
                        onHover={() => setActiveIdx(i)}
                        onNavigate={() => go(p)}
                        describedBy={`${listboxId}-players`}
                      />
                    ))}

                    {/* Articles */}
                    {articles.length > 0 && (
                      <SectionHeading id={`${listboxId}-articles`}>
                        Articles
                      </SectionHeading>
                    )}
                    {articles.map((a, i) => {
                      const idx = playersEnd + i;
                      return (
                        <ArticleOption
                          key={resultKey(a)}
                          id={optionId(idx)}
                          result={a}
                          active={idx === activeIdx}
                          onHover={() => setActiveIdx(idx)}
                          onNavigate={() => go(a)}
                          describedBy={`${listboxId}-articles`}
                        />
                      );
                    })}

                    {/* Tools */}
                    {tools.length > 0 && (
                      <SectionHeading id={`${listboxId}-tools`}>
                        Tools
                      </SectionHeading>
                    )}
                    {tools.map((t, i) => {
                      const idx = articlesEnd + i;
                      return (
                        <ToolOption
                          key={resultKey(t)}
                          id={optionId(idx)}
                          result={t}
                          active={idx === activeIdx}
                          onHover={() => setActiveIdx(idx)}
                          onNavigate={() => go(t)}
                          describedBy={`${listboxId}-tools`}
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ---------- presentational option rows ---------- */

function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <li
      id={id}
      role="presentation"
      className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
    >
      {children}
    </li>
  );
}

/** Shared wrapper for a selectable option. The <Link> carries the href so
 * middle-click and open-in-new-tab work, but a plain left click navigates
 * through onNavigate (router.push) instead of the Link's own click handler.
 *
 * Two subtleties, both learned the hard way, drive this:
 *  1. We preventDefault on the click so the Link does NOT also navigate. Firing
 *     both the Link's navigation and router.push sends two navigations to the
 *     same href; on same-segment routes (player to player, article to article)
 *     Next.js drops one and the user is stranded on the current page.
 *  2. We navigate via router.push (owned by the always-mounted SiteSearch), not
 *     the Link, because onNavigate also closes the dialog, which unmounts this
 *     Link. Next.js aborts a Link's in-flight navigation when it unmounts, so a
 *     Link-driven navigation would be cancelled by the close.
 * Modified / non-primary clicks fall through untouched so the browser can open
 * the href in a new tab. */
function OptionRow({
  id,
  active,
  href,
  describedBy,
  onHover,
  onNavigate,
  children,
}: {
  id: string;
  active: boolean;
  href: string;
  describedBy: string;
  onHover: () => void;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <li id={id} role="option" aria-selected={active} aria-describedby={describedBy}>
      <Link
        href={href}
        tabIndex={-1}
        onMouseEnter={onHover}
        onClick={(e) => {
          // Let modified / non-primary clicks open a new tab and keep the dialog
          // open.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
            return;
          }
          e.preventDefault();
          onNavigate();
        }}
        className={`flex min-h-11 items-center gap-3 px-4 py-2.5 transition-colors ${
          active ? "bg-brand-purple/15" : ""
        }`}
      >
        {children}
      </Link>
    </li>
  );
}

function PlayerOption({
  id,
  result,
  active,
  onHover,
  onNavigate,
  describedBy,
}: {
  id: string;
  result: PlayerResult;
  active: boolean;
  onHover: () => void;
  onNavigate: () => void;
  describedBy: string;
}) {
  const detail = [result.position, result.team].filter(Boolean).join(", ");
  return (
    <OptionRow
      id={id}
      active={active}
      href={`/players/${result.slug}`}
      describedBy={describedBy}
      onHover={onHover}
      onNavigate={onNavigate}
    >
      <PlayerHeadshot
        sleeperId={result.sleeperId}
        name=""
        size={32}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {result.name}
        </span>
        {detail && (
          <span className="block truncate text-xs text-ink-subtle">{detail}</span>
        )}
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-ink-subtle"
      />
    </OptionRow>
  );
}

function ArticleOption({
  id,
  result,
  active,
  onHover,
  onNavigate,
  describedBy,
}: {
  id: string;
  result: ArticleResult;
  active: boolean;
  onHover: () => void;
  onNavigate: () => void;
  describedBy: string;
}) {
  const meta = [
    result.articleType.replace(/_/g, " "),
    result.publishedAt ? formatEasternDate(result.publishedAt) : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <OptionRow
      id={id}
      active={active}
      href={`/brief/${result.slug}`}
      describedBy={describedBy}
      onHover={onHover}
      onNavigate={onNavigate}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {result.title}
        </span>
        <span className="block truncate text-xs capitalize text-ink-subtle">
          {meta}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-ink-subtle"
      />
    </OptionRow>
  );
}

function ToolOption({
  id,
  result,
  active,
  onHover,
  onNavigate,
  describedBy,
}: {
  id: string;
  result: ToolResult;
  active: boolean;
  onHover: () => void;
  onNavigate: () => void;
  describedBy: string;
}) {
  return (
    <OptionRow
      id={id}
      active={active}
      href={result.tool.href}
      describedBy={describedBy}
      onHover={onHover}
      onNavigate={onNavigate}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {result.tool.label}
        </span>
        <span className="block truncate text-xs text-ink-subtle">
          {result.tool.description}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-ink-subtle"
      />
    </OptionRow>
  );
}
