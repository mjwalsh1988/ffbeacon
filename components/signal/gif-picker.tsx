"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X, ArrowLeft } from "lucide-react";
import {
  GIF_ALT_MAX,
  graphemeLength,
  type SignalGifInput,
} from "@/lib/signal";
import type { GiphyResult } from "@/lib/signal/giphy";

/**
 * GIF picker backed by the server-side GIPHY proxy (/api/signal/gif/search). It is
 * fully keyboard operable and announces state through a polite live region.
 *
 * Two stages:
 *   1. search  - a labeled query box (debounced) and a grid of result buttons,
 *      each labeled with the GIF's resolved description.
 *   2. describe - after a GIF is chosen, a required description field pre-filled
 *      with GIPHY's resolved alt (alt_text, else title). The user can edit it.
 *      Because GIPHY's alt_text is not guaranteed on the free tier, the field is
 *      always required (Insert stays disabled while it is empty): a GIF is never
 *      inserted without accessible text.
 *
 * A visible "Powered by GIPHY" attribution is rendered with the results (required
 * for production-key approval). On insert, the parent returns focus to the composer
 * textarea.
 */

const SEARCH_DEBOUNCE_MS = 450;
const PAGE_SIZE = 24;

export function GifPicker({
  onInsert,
  onClose,
}: {
  onInsert: (gif: SignalGifInput) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"search" | "describe">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GiphyResult | null>(null);
  const [altDraft, setAltDraft] = useState("");

  const regionId = useId();
  const searchId = useId();
  const altId = useId();
  const altHelpId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const altRef = useRef<HTMLInputElement>(null);

  // Focus the search box when the picker opens.
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Debounced search whenever the query changes (search-on-query only; no trending).
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setHasMore(false);
      setOffset(0);
      setStatus("");
      return;
    }
    const handle = setTimeout(() => {
      void runSearch(q, 0, false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function runSearch(q: string, nextOffset: number, append: boolean) {
    setLoading(true);
    setError(null);
    if (!append) setStatus("Searching...");
    try {
      const res = await fetch(
        `/api/signal/gif/search?q=${encodeURIComponent(q)}&offset=${nextOffset}`,
        { headers: { "x-requested-with": "ff-beacon" } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        results?: GiphyResult[];
        hasMore?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not search GIFs. Please try again.");
        setStatus("");
        return;
      }
      const incoming = data.results ?? [];
      setResults((prev) => (append ? [...prev, ...incoming] : incoming));
      setHasMore(Boolean(data.hasMore));
      setOffset(nextOffset);
      const total = (append ? results.length : 0) + incoming.length;
      setStatus(
        total === 0
          ? "No GIFs found. Try a different search."
          : `Showing ${total} GIF${total === 1 ? "" : "s"}.`,
      );
    } catch {
      setError("Could not search GIFs. Please try again.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  const choose = (gif: GiphyResult) => {
    setSelected(gif);
    setAltDraft(gif.alt);
    setStage("describe");
    setError(null);
    requestAnimationFrame(() => altRef.current?.focus());
  };

  const backToSearch = () => {
    setStage("search");
    setSelected(null);
    setError(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const altChars = graphemeLength(altDraft);
  const altEmpty = altDraft.trim().length === 0;
  const altTooLong = altDraft.trim().length > GIF_ALT_MAX;

  const insert = () => {
    if (!selected || altEmpty || altTooLong) return;
    onInsert({
      giphy_id: selected.id,
      url: selected.url,
      preview_url: selected.preview_url,
      alt: altDraft.trim(),
      width: selected.width,
      height: selected.height,
    });
  };

  return (
    <section
      aria-label="GIF search"
      className="mt-3 rounded-card border border-line bg-base p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Powered by GIPHY
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Close GIF search
        </button>
      </div>

      <p
        id={regionId}
        aria-live="polite"
        role="status"
        className="sr-only"
      >
        {status}
      </p>
      <div aria-live="assertive">
        {error && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>

      {stage === "search" ? (
        <div className="mt-2">
          <label htmlFor={searchId} className="block text-sm font-medium text-ink">
            Search GIFs
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-card border border-line bg-surface px-3">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
            <input
              ref={searchRef}
              id={searchId}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-describedby={regionId}
              placeholder="Search for a GIF"
              className="h-11 w-full bg-transparent text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:outline-none"
            />
          </div>

          {results.length > 0 && (
            <ul
              role="list"
              className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {results.map((gif) => (
                <li key={gif.id}>
                  <button
                    type="button"
                    onClick={() => choose(gif)}
                    aria-label={
                      gif.alt
                        ? `Choose GIF: ${gif.alt}`
                        : "Choose GIF (no description provided)"
                    }
                    className="block w-full overflow-hidden rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    {/* Decorative here: the button's aria-label carries the text. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={gif.preview_url}
                      alt=""
                      loading="lazy"
                      className="h-28 w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <div className="mt-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => void runSearch(query.trim(), offset + PAGE_SIZE, true)}
                className="inline-flex h-11 items-center justify-center rounded-card border border-line px-4 text-sm font-medium text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                {loading ? "Loading..." : "Show more GIFs"}
              </button>
            </div>
          )}

          <p aria-hidden="true" className="mt-2 min-h-[1rem] text-xs text-ink-muted">
            {status}
          </p>
        </div>
      ) : (
        selected && (
          <div className="mt-2">
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selected.preview_url}
                alt=""
                className="h-24 w-24 shrink-0 rounded-card border border-line object-cover"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={altId} className="block text-sm font-medium text-ink">
                  Describe this GIF (required)
                </label>
                <input
                  ref={altRef}
                  id={altId}
                  type="text"
                  value={altDraft}
                  maxLength={GIF_ALT_MAX}
                  onChange={(e) => setAltDraft(e.target.value)}
                  aria-describedby={altHelpId}
                  aria-invalid={altEmpty || altTooLong}
                  placeholder="What happens in this GIF?"
                  className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none"
                />
                <p id={altHelpId} className="mt-1 text-xs text-ink-muted">
                  {altChars} of {GIF_ALT_MAX} characters. This is read aloud to
                  people using a screen reader.
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={altEmpty || altTooLong}
                onClick={insert}
                className="inline-flex h-11 items-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
              >
                Insert GIF
              </button>
              <button
                type="button"
                onClick={backToSearch}
                className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Back to results
              </button>
            </div>
          </div>
        )
      )}
    </section>
  );
}
