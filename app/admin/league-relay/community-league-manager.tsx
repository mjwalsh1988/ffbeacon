"use client";

/**
 * Nominating community leagues, and reading what they would say.
 *
 * TWO WAYS IN, BOTH IN ONE FIELD. Typing a name searches the leagues already
 * synced here; typing a Sleeper id that matches nothing stored asks Sleeper
 * directly, so a league nobody has ever opened on the site can still be
 * nominated. One field rather than two, because an admin holding an id should
 * not have to know which box it belongs in.
 *
 * THE PREVIEW IS THE POINT OF THIS SCREEN. Nothing else on the site writes
 * prose about a real person's team and posts it into a room they are in, so
 * "read it before it goes out" is not a nicety. Preview runs the real builders
 * on the real league and returns the exact text a channel would get, having
 * claimed nothing and sent nothing.
 *
 * Accessibility: the search results are a list with a live region announcing
 * how many were found, every row action is a button, the preview output is in a
 * labelled region, and destructive actions say what survives them.
 */

import { useId, useState, useTransition } from "react";
import { Eye, Pause, Play, Plus, Search, Send, Trash2, Undo2 } from "lucide-react";
import { formatEastern, formatRelative } from "@/lib/datetime";
import {
  RELAY_MESSAGE_LABEL,
  RELAY_MESSAGE_TYPES,
  type RelayMessageType,
} from "@/lib/league-relay/default-settings";
import {
  addCommunityLeagueAction,
  previewRelayAction,
  removeCommunityLeagueAction,
  rewindWatermarkAction,
  runRelayNowAction,
  searchLeaguesAction,
  setCommunityLeagueActiveAction,
  type LeagueSearchHit,
} from "./actions";

const inputCls =
  "min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const buttonCls =
  "inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50";

export interface CommunityLeagueView {
  id: string;
  leagueRowId: string;
  sleeperLeagueId: string;
  name: string;
  label: string | null;
  season: number | null;
  totalRosters: number | null;
  isActive: boolean;
  watermarkAt: string;
  lastSyncedAt: string | null;
  syncStatus: string;
  syncDetail: string | null;
  postsLast7Days: number;
}

export function CommunityLeagueManager({ leagues }: { leagues: CommunityLeagueView[] }) {
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">
        {status?.text ?? ""}
      </p>

      <AddLeague onStatus={setStatus} />

      <section aria-labelledby="community-list-heading" className="space-y-3">
        <h3 id="community-list-heading" className="text-sm font-semibold text-ink">
          Community leagues ({leagues.length})
        </h3>
        {leagues.length === 0 ? (
          <p className="rounded-card border border-line bg-surface/40 p-4 text-sm text-ink-muted">
            None yet. Search above to nominate one. A nominated league resyncs every fifteen
            minutes and its activity gets written up.
          </p>
        ) : (
          <ul className="space-y-3">
            {leagues.map((league) => (
              <li key={league.id}>
                <LeagueRow league={league} onStatus={setStatus} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {status && (
        <p
          className={`text-sm ${status.tone === "ok" ? "text-signal-success" : "text-signal-danger"}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}

/* ---------- Search and add ---------- */

function AddLeague({
  onStatus,
}: {
  onStatus: (s: { tone: "ok" | "bad"; text: string }) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeagueSearchHit[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  function search() {
    const q = query.trim();
    if (q.length < 2) {
      onStatus({ tone: "bad", text: "Type at least two characters, or a Sleeper league id." });
      return;
    }
    startSearch(async () => {
      const results = await searchLeaguesAction(q);
      setHits(results);
    });
  }

  return (
    <section aria-labelledby="add-league-heading" className="rounded-modal border border-line bg-surface/40 p-5">
      <h3 id="add-league-heading" className="text-sm font-semibold text-ink">
        Add a community league
      </h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
        Search by league name across the leagues already synced here, or paste a Sleeper
        league id to nominate one the site has never seen. An unsynced league is synced in
        full before it is added, and its watermark is set to the moment you add it, so
        nothing already in its history is posted.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
            League name or Sleeper league id
          </label>
          <input
            id={id}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            placeholder="The Beacon Invitational, or 1180299608914599936"
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <button type="button" onClick={search} disabled={searching} className={buttonCls}>
          <Search aria-hidden="true" className="h-4 w-4" />
          {searching ? "Searching" : "Search"}
        </button>
      </div>

      {hits !== null && (
        <div className="mt-4">
          <p aria-live="polite" className="text-xs text-ink-muted">
            {hits.length === 0
              ? "Nothing matched. A name only matches leagues already synced here; for anything else, paste the Sleeper league id."
              : `${hits.length} league${hits.length === 1 ? "" : "s"} found.`}
          </p>
          {hits.length > 0 && (
            <ul className="mt-2 space-y-2">
              {hits.map((hit) => (
                <li
                  key={hit.sleeperLeagueId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-base p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{hit.name}</p>
                    <p className="text-xs text-ink-subtle">
                      {[
                        hit.season ? `${hit.season}` : null,
                        hit.totalRosters ? `${hit.totalRosters} teams` : null,
                        hit.leagueRowId ? "synced here" : "not synced yet",
                        `id ${hit.sleeperLeagueId}`,
                      ]
                        .filter(Boolean)
                        .join(" | ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={adding || hit.alreadyCommunity}
                    onClick={() =>
                      startAdd(async () => {
                        const result = await addCommunityLeagueAction(hit.sleeperLeagueId, null);
                        onStatus(
                          result.ok
                            ? { tone: "ok", text: result.message ?? "Added." }
                            : { tone: "bad", text: result.error },
                        );
                        if (result.ok) setHits(null);
                      })
                    }
                    className={buttonCls}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    {hit.alreadyCommunity ? "Already added" : adding ? "Adding" : "Add"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- One league ---------- */

function LeagueRow({
  league,
  onStatus,
}: {
  league: CommunityLeagueView;
  onStatus: (s: { tone: "ok" | "bad"; text: string }) => void;
}) {
  const [busy, startBusy] = useTransition();
  const [preview, setPreview] = useState<
    Array<{ type: RelayMessageType; text: string; note: string }> | null
  >(null);
  const [previewNotes, setPreviewNotes] = useState<string[]>([]);
  const [types, setTypes] = useState<RelayMessageType[]>(["trade"]);
  const previewId = useId();

  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startBusy(async () => {
      const result = await fn();
      onStatus(
        result.ok
          ? { tone: "ok", text: result.message ?? "Done." }
          : { tone: "bad", text: result.error ?? "That failed." },
      );
    });

  return (
    <div className="rounded-card border border-line bg-surface/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {league.label ?? league.name}
            {!league.isActive && (
              <span className="ml-2 rounded-pill border border-line px-2 py-0.5 text-[11px] font-normal text-ink-subtle">
                Paused
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {[
              league.season ? `${league.season}` : null,
              league.totalRosters ? `${league.totalRosters} teams` : null,
              `id ${league.sleeperLeagueId}`,
              league.lastSyncedAt ? `synced ${formatRelative(league.lastSyncedAt)}` : "never synced",
              `${league.postsLast7Days} posted in 7 days`,
            ]
              .filter(Boolean)
              .join(" | ")}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-subtle">
            Nothing before {formatEastern(league.watermarkAt)} is written up.
          </p>
          {league.syncStatus === "error" && league.syncDetail && (
            <p role="alert" className="mt-1 text-[11px] text-signal-danger">
              Last sync failed: {league.syncDetail}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act(() => setCommunityLeagueActiveAction(league.id, !league.isActive))
            }
            className={buttonCls}
          >
            {league.isActive ? (
              <>
                <Pause aria-hidden="true" className="h-4 w-4" />
                Pause
              </>
            ) : (
              <>
                <Play aria-hidden="true" className="h-4 w-4" />
                Resume
              </>
            )}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => rewindWatermarkAction(league.id, 24))}
            className={buttonCls}
          >
            <Undo2 aria-hidden="true" className="h-4 w-4" />
            Rewind 24h
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const result = await runRelayNowAction(league.leagueRowId);
                if (!result.ok) return result;
                const r = result.result;
                return {
                  ok: true,
                  message: `Ran: ${r.posted} posted, ${r.skipped} skipped, ${r.errors} failed. ${r.notes.join(" ")}`,
                };
              })
            }
            className={buttonCls}
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            Run now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              // eslint-disable-next-line no-alert
              if (!window.confirm(`Remove ${league.name} from the relay? What it has already posted is kept.`)) return;
              act(() => removeCommunityLeagueAction(league.id));
            }}
            className={`${buttonCls} hover:border-signal-danger/60 hover:text-signal-danger`}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>

      {/* ---------- Preview ---------- */}
      <div className="mt-4 border-t border-line pt-4">
        <fieldset>
          <legend className="text-xs font-medium text-ink-subtle">
            Preview what this league would post
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {RELAY_MESSAGE_TYPES.map((type) => {
              const on = types.includes(type);
              return (
                <label
                  key={type}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 text-xs transition-colors ${
                    on
                      ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                      : "border-line bg-base text-ink-muted hover:border-line-accent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setTypes((t) =>
                        t.includes(type) ? t.filter((x) => x !== type) : [...t, type],
                      )
                    }
                    className="h-4 w-4 shrink-0 rounded border-line bg-base text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  />
                  {RELAY_MESSAGE_LABEL[type]}
                </label>
              );
            })}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                startBusy(async () => {
                  const result = await previewRelayAction(league.leagueRowId, types);
                  if (!result.ok) {
                    onStatus({ tone: "bad", text: result.error });
                    return;
                  }
                  setPreview(result.result.messages);
                  setPreviewNotes(result.result.notes);
                  onStatus({
                    tone: "ok",
                    text: `${result.result.messages.length} preview${
                      result.result.messages.length === 1 ? "" : "s"
                    } built. Nothing was posted.`,
                  });
                })
              }
              className={buttonCls}
            >
              <Eye aria-hidden="true" className="h-4 w-4" />
              {busy ? "Building" : "Preview"}
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            Runs the real builders on the most recent real example of each type and shows
            the exact text a channel would get. It ignores the on/off switches and the
            watermark, claims nothing, and sends nothing.
          </p>
        </fieldset>

        {preview !== null && (
          <div id={previewId} className="mt-4 space-y-3">
            {previewNotes.map((note) => (
              <p key={note} className="text-[11px] text-ink-subtle">
                {note}
              </p>
            ))}
            {preview.map((message, index) => (
              <article
                key={`${message.type}-${index}`}
                className="rounded-card border border-line bg-base p-4"
              >
                <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
                  {RELAY_MESSAGE_LABEL[message.type]}
                </h4>
                <p className="mt-0.5 text-[11px] text-ink-subtle">{message.note}</p>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-card bg-surface/60 p-3 text-xs leading-relaxed text-ink">
                  {message.text}
                </pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
