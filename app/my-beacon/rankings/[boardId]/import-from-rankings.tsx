"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isDefenderScope, type BoardScope, type ImportedRankingPlayer } from "@/lib/ranking-boards";
import { positionNoun } from "@/lib/site";

const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;

export type ImportSource = {
  slug: string;
  displayName: string;
  supportedFormatSlugs: string[] | null;
};
export type ImportFormat = { slug: string; displayName: string };

/** A source supports a format when its list is null ("all") or contains the
 * slug. Mirrors lib/source.ts sourceSupportsFormat for client-side gating. */
function supportsFormat(source: ImportSource | undefined, formatSlug: string) {
  if (!source) return false;
  return source.supportedFormatSlugs === null
    ? true
    : source.supportedFormatSlugs.includes(formatSlug);
}

/**
 * "Start from our rankings": replace the board with a source's current list.
 * The board records the format and the source that actually answered, so an
 * imported board carries a format and can count toward the community rankings
 * without being built in Beacon Ranker.
 *
 * Board-local, like Beacon Ranker's wizard: choosing KTC here never changes the
 * reader's site-wide source.
 */
export function ImportFromRankings({
  scope,
  sources,
  formats,
  defaultSourceSlug,
  defaultFormatSlug,
  currentPlayerCount,
  onImport,
}: {
  scope: BoardScope;
  sources: ImportSource[];
  formats: ImportFormat[];
  defaultSourceSlug: string | null;
  /** The board's own format when it has one. */
  defaultFormatSlug: string | null;
  currentPlayerCount: number;
  onImport: (
    players: ImportedRankingPlayer[],
    provenance: { formatSlug: string; sourceSlug: string | null },
  ) => Promise<boolean>;
}) {
  const sourceId = useId();
  const formatId = useId();
  const headingId = useId();

  const [sourceSlug, setSourceSlug] = useState<string>(
    defaultSourceSlug ?? sources[0]?.slug ?? "",
  );
  const activeSource = sources.find((s) => s.slug === sourceSlug);

  const supportedFormats = useMemo(
    () => formats.filter((f) => supportsFormat(activeSource, f.slug)),
    [formats, activeSource],
  );

  const [formatSlug, setFormatSlug] = useState<string>(
    (defaultFormatSlug && supportedFormats.some((f) => f.slug === defaultFormatSlug)
      ? defaultFormatSlug
      : null) ??
      supportedFormats[0]?.slug ??
      formats[0]?.slug ??
      "",
  );

  useEffect(() => {
    if (!supportedFormats.some((f) => f.slug === formatSlug)) {
      setFormatSlug(supportedFormats[0]?.slug ?? "");
    }
  }, [supportedFormats, formatSlug]);

  const [importing, setImporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  if (isDefenderScope(scope)) {
    // No source ranks a defender, so there is nothing to import. Said, not
    // hidden, so the reader knows why the control is missing.
    return (
      <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
        No rankings source ranks defensive players yet, so there is nothing to import for this
        board. Build it by comparing, or add players by hand.
      </p>
    );
  }

  const scopeWord = scope === "overall" ? "overall" : positionNoun(scope);

  const handleImportClick = () => {
    if (!sourceSlug || !formatSlug) return;
    if (currentPlayerCount > 0) {
      setConfirmOpen(true);
      return;
    }
    void performImport();
  };

  const performImport = async () => {
    if (!sourceSlug || !formatSlug) return;
    setImporting(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ source: sourceSlug, format: formatSlug, scope });
      const res = await fetch(`/api/rankings/import?${params.toString()}`, {
        headers: FETCH_HEADERS,
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: "Import failed. Please try again." });
        return;
      }
      const json = (await res.json()) as {
        players: ImportedRankingPlayer[];
        source: string | null;
        sourceDisplay: string | null;
        requestedDisplay: string;
        formatDisplay: string;
        fellBack: boolean;
      };
      if (!json.players || json.players.length === 0) {
        setMessage({
          kind: "error",
          text: `No ranked ${scopeWord} players found for that source and format.`,
        });
        return;
      }
      const ok = await onImport(json.players, { formatSlug, sourceSlug: json.source });
      if (!ok) {
        setMessage({ kind: "error", text: "Imported the rankings but saving failed. Try again." });
        return;
      }
      const fallbackNote = json.fellBack
        ? ` ${json.requestedDisplay} has no data for ${json.formatDisplay}, so we used ${json.sourceDisplay}.`
        : "";
      setMessage({
        kind: "success",
        text: `Imported ${json.players.length} player${
          json.players.length === 1 ? "" : "s"
        } from ${json.sourceDisplay}, ${json.formatDisplay}.${fallbackNote}`,
      });
    } catch {
      setMessage({ kind: "error", text: "Import failed. Please try again." });
    } finally {
      setImporting(false);
    }
  };

  if (sources.length === 0 || formats.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <Download className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold text-ink">
            Start from our rankings
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Import our current {scopeWord} rankings as a starting point, then reorder and
            customize. The board remembers the format you pick. Your site-wide source and format
            do not change.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor={sourceId} className="block text-sm font-medium text-ink">
            Source
          </label>
          <select
            id={sourceId}
            value={sourceSlug}
            onChange={(event) => setSourceSlug(event.target.value)}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink focus:border-brand-purple focus:outline-none sm:py-2 sm:text-sm"
          >
            {sources.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={formatId} className="block text-sm font-medium text-ink">
            Format
          </label>
          <select
            id={formatId}
            value={formatSlug}
            onChange={(event) => setFormatSlug(event.target.value)}
            disabled={supportedFormats.length === 0}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink focus:border-brand-purple focus:outline-none disabled:opacity-50 sm:py-2 sm:text-sm"
          >
            {supportedFormats.length === 0 ? (
              <option value="">No formats for this source</option>
            ) : (
              supportedFormats.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.displayName}
                </option>
              ))
            )}
          </select>
        </div>
        <button
          type="button"
          onClick={handleImportClick}
          disabled={importing || !sourceSlug || !formatSlug}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-card border border-line bg-surface-elevated px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50 sm:h-10"
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {importing ? "Importing..." : "Import rankings"}
        </button>
      </div>

      {currentPlayerCount > 0 && (
        <p className="mt-2 text-xs text-ink-subtle">
          Importing replaces the {currentPlayerCount} player
          {currentPlayerCount === 1 ? "" : "s"} already on this board.
        </p>
      )}

      <div aria-live="polite" className="min-h-[1.25rem]">
        {message && (
          <p
            role={message.kind === "error" ? "alert" : undefined}
            className={`mt-2 text-sm ${
              message.kind === "error" ? "text-signal-danger" : "text-signal-success"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>

      {confirmOpen && (
        <ConfirmDialog
          icon={AlertTriangle}
          tone="danger"
          title="Replace this board?"
          description={
            <>
              Importing rankings will replace the{" "}
              <span className="font-semibold text-ink">
                {currentPlayerCount} player{currentPlayerCount === 1 ? "" : "s"}
              </span>{" "}
              currently on this board, including any custom order and tier lines. This cannot be
              undone.
            </>
          }
          confirmLabel="Replace board"
          cancelLabel="Keep current"
          onConfirm={() => {
            setConfirmOpen(false);
            void performImport();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}
