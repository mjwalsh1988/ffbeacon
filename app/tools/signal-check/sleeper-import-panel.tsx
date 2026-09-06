"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronRight,
  Loader2,
  LogIn,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useStepScroll } from "@/lib/use-step-scroll";
import { SleeperIdentityCard } from "@/components/sleeper-handle/identity-card";
import { SaveHandleForm } from "@/components/sleeper-handle/save-handle-form";
import { SaveHandleNotice } from "@/components/sleeper-handle/save-handle-notice";
import { LeagueChoiceList } from "@/components/league-choice-list";
import type { SavedSleeperHandle } from "@/lib/sleeper-handle/types";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { SideKey } from "@/lib/signal-check/types";
import { TradeResult, type ResultAssetMetaBySide } from "./trade-result";
import {
  listImportLeagues,
  listLeagueTrades,
  importAndAnalyze,
  type ImportLeague,
  type ImportTrade,
  type ImportTradeTeam,
} from "./import-actions";

/** The trade list, named so choosing a league can land the reader on it. */
const TRADE_LIST_ID = "sc-import-trades";

function teamAssetsText(t: ImportTradeTeam): string {
  const parts: string[] = [];
  if (t.playerCount > 0)
    parts.push(`${t.playerCount} player${t.playerCount === 1 ? "" : "s"}`);
  if (t.pickCount > 0)
    parts.push(`${t.pickCount} pick${t.pickCount === 1 ? "" : "s"}`);
  return parts.join(", ") || "nothing";
}

/**
 * Inline Sleeper import for the Signal Check page. Adapts to auth state:
 *  - signed out: the sign-in button and the guest notice
 *  - signed in, no saved handle: the shared save form, which always saves
 *  - signed in with a handle: the identity card, then pick a league and a
 *    trade card, which imports and analyzes it right here (no separate page).
 *
 * Saving here ALWAYS saves, which is why the form is `mode="settings"` and
 * carries no "save this" checkbox. Every other tool offers a one-off lookup
 * because it can act for a handle typed into the box; this one cannot.
 * `listImportLeagues` reads the SAVED handle on the server on every call, so a
 * handle that was not saved would change nothing about what gets imported.
 *
 * The panel is shown or hidden by the workspace around it, which swaps it in
 * for the trade builder. Every state therefore carries the same way back:
 * `onBack` returns the reader to the builder with the trade they were part way
 * through still intact.
 */
export function SleeperImportPanel({
  signedIn,
  initialUsername,
  onBack,
}: {
  signedIn: boolean;
  initialUsername: string | null;
  onBack: () => void;
}) {
  // The server render knows the handle; the panel starts with the name alone
  // and takes the rest (display name, avatar, Sleeper user id) off the first
  // league list, which resolves the same identity server-side anyway.
  const [handle, setHandle] = useState<SavedSleeperHandle | null>(
    initialUsername
      ? {
          username: initialUsername,
          sleeperUserId: null,
          displayName: null,
          avatar: null,
          verifiedAt: null,
        }
      : null,
  );

  const [leagues, setLeagues] = useState<ImportLeague[]>([]);
  const [leaguesLoaded, setLeaguesLoaded] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [loadingLeagues, startLeagues] = useTransition();

  const [leagueId, setLeagueId] = useState("");
  /**
   * The league whose trades are on screen, which is NOT the highlighted one.
   *
   * Selection moves on every arrow key in a radiogroup. Keying the scroll and
   * the trade section on `leagueId` therefore pulled focus out of the group on
   * the first Down press (useStepScroll focuses as well as scrolls, so league
   * two was unreachable) and mounted an empty trade list that said "No
   * completed trades found in this league yet" about a league nothing had
   * looked at yet. Both belong to the league that was actually loaded.
   */
  const [loadedLeagueId, setLoadedLeagueId] = useState("");
  const [trades, setTrades] = useState<ImportTrade[]>([]);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [loadingTrades, startTrades] = useTransition();

  const [selectedTradeId, setSelectedTradeId] = useState("");
  const [view, setView] = useState<BuilderView | null>(null);
  const [assetMeta, setAssetMeta] = useState<ResultAssetMetaBySide | null>(
    null,
  );
  const [evidence, setEvidence] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [analyzing, startAnalyze] = useTransition();

  const resultRef = useRef<HTMLDivElement>(null);

  // Choosing a league is a question being answered, so land on the trades it
  // found rather than leaving the reader on the select they have finished
  // with. Clearing the league back to none moves nobody.
  useStepScroll(loadedLeagueId || null, { id: TRADE_LIST_ID });

  function loadLeagues() {
    setLeaguesError(null);
    startLeagues(async () => {
      const res = await listImportLeagues();
      if (res.ok) {
        // The server resolved the identity to make this call, so take the full
        // handle back rather than showing a card with no face on it.
        setHandle(res.handle);
        setLeagues(res.leagues);
        setLeaguesLoaded(true);
        // One league is not a choice, so it is selected AND loaded. No arrow
        // key was involved, so the hazard the two-step exists for cannot apply.
        if (res.leagues.length === 1) {
          selectLeague(res.leagues[0].sleeperLeagueId);
          loadLeagueTrades(res.leagues[0].sleeperLeagueId);
        }
      } else {
        if (res.needsUsername) setHandle(null);
        setLeaguesError(res.error);
        setLeaguesLoaded(true);
      }
    });
  }

  // The panel only mounts once the reader asks for it, so load the league list
  // as soon as we have a handle to load it with.
  useEffect(() => {
    if (handle && !leaguesLoaded && !loadingLeagues) loadLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.username, leaguesLoaded]);

  /**
   * A handle was just saved. It may belong to a different Sleeper account, so
   * the league list, the trade list and any result on screen are all about
   * somebody else now and are cleared rather than left to look current.
   */
  function onHandleSaved(saved: SavedSleeperHandle) {
    setHandle(saved);
    setLeagues([]);
    setLeaguesError(null);
    setLeaguesLoaded(false);
    setLeagueId("");
    setTrades([]);
    setTradesError(null);
    setSelectedTradeId("");
    resetResult();
  }

  function resetResult() {
    setView(null);
    setAssetMeta(null);
    setShareUrl(null);
    setEvidence([]);
    setNotices([]);
    setAnalyzeError(null);
  }

  /**
   * Choosing a row, which is deliberately NOT loading it.
   *
   * `LeagueChoiceList` is a real radiogroup, so arrow keys move between rows
   * AND change the selection. Loading on change would therefore run
   * `listLeagueTrades` (a full `pulseLeague`) once per arrow press, and a
   * keyboard reader could not reach the fifth league without starting four
   * league syncs. The `<select>` this replaced never had that problem, because
   * a platform picker commits on Enter. So the row is the choice and
   * "Load this league" is the action, matching the Beacon Breakdown picker.
   */
  function selectLeague(id: string) {
    setLeagueId(id);
    setLoadedLeagueId("");
    setTrades([]);
    setTradesError(null);
    setSelectedTradeId("");
    resetResult();
  }

  /** The action. Only ever runs when the reader asked for it. */
  function loadLeagueTrades(id: string) {
    if (!id) return;
    setLoadedLeagueId("");
    setTrades([]);
    setTradesError(null);
    setSelectedTradeId("");
    resetResult();
    startTrades(async () => {
      const res = await listLeagueTrades(id);
      if (res.ok) {
        setTrades(res.trades);
        setLoadedLeagueId(id);
      } else setTradesError(res.error);
    });
  }

  function pickTrade(tradeId: string, makePublic = false) {
    setSelectedTradeId(tradeId);
    setAnalyzeError(null);
    startAnalyze(async () => {
      const res = await importAndAnalyze({
        sleeperLeagueId: leagueId,
        sleeperTransactionId: tradeId,
        makePublic,
      });
      if (res.ok) {
        setView(res.view);
        setAssetMeta(res.assetMeta);
        setEvidence(res.evidence);
        setNotices(res.notices);
        if (makePublic) {
          setShareUrl(res.shareUrl);
          // TradeResult moves focus to the share input when the link appears.
        } else {
          requestAnimationFrame(() => resultRef.current?.focus());
        }
      } else {
        setView(null);
        setAnalyzeError(res.error);
      }
    });
  }

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the input is selectable as a fallback */
    }
  }

  // ---- Signed out -------------------------------------------------------
  if (!signedIn) {
    return (
      <PanelShell>
        <BackBar onBack={onBack} />
        <PanelHeader
          title="Import a trade from Sleeper"
          description="Sign in and save your Sleeper username to pull completed trades straight into Signal Check, with your league format detected automatically."
        />
        <div className="mt-4">
          <Link
            href="/login?next=/tools/signal-check"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <LogIn aria-hidden="true" className="h-4 w-4" />
            Sign in to import trades
          </Link>
        </div>
        <SaveHandleNotice state="guest" nextPath="/tools/signal-check" />
      </PanelShell>
    );
  }

  // ---- Signed in, no saved handle: the shared save form ----------------
  if (!handle) {
    return (
      <PanelShell>
        <BackBar onBack={onBack} />
        <PanelHeader
          title="First, connect your Sleeper username"
          description="We use your saved handle to find your leagues. We never post anything to Sleeper, and your league details stay private."
        />
        <div className="mt-4">
          <SaveHandleForm
            submitLabel="Save and continue"
            onSaved={onHandleSaved}
          />
          <SavedHandleHint />
        </div>
      </PanelShell>
    );
  }

  // ---- Signed in with a handle: league + trade picker -------------------
  return (
    <PanelShell>
      <BackBar onBack={onBack} />

      <SleeperIdentityCard
        toolName="the Sleeper import"
        handle={handle}
        headingLevel={2}
        changeLabel="Change username"
        compact
      >
        <SaveHandleForm
          defaultUsername={handle.username}
          submitLabel="Save username"
          onSaved={onHandleSaved}
        />
      </SleeperIdentityCard>

      <div className="mt-3 space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Choose a league, then tap the trade you want to analyze. We detect the
          league format automatically.
        </p>

        {/* League picker. A list rather than a select, because a select cannot
            show a league its own logo. */}
        <div>
          <p className="text-sm font-medium text-ink">Your Sleeper league</p>

          {loadingLeagues ? (
            <div
              role="status"
              className="mt-2 flex items-center gap-2 rounded-card border border-line bg-base/40 p-4 text-sm text-ink-muted"
            >
              <Loader2
                aria-hidden="true"
                className="h-4 w-4 animate-spin text-brand-cyan"
              />
              Loading your leagues...
            </div>
          ) : leagues.length > 0 ? (
            <>
              <LeagueChoiceList
                label="Your Sleeper league"
                choices={leagues.map((l) => ({
                  sleeperLeagueId: l.sleeperLeagueId,
                  name: l.name,
                  avatar: l.avatar,
                  meta: l.season,
                  categoryKey: l.categoryKey,
                }))}
                value={leagueId}
                onChange={selectLeague}
                logoSize={40}
                className="mt-2 max-w-md"
              />
              <button
                type="button"
                onClick={() => loadLeagueTrades(leagueId)}
                // Disabled only while the work is in flight, never because the
                // league is already loaded: a browser blurs a focused element the
                // moment it is disabled, and a button that disables itself in the
                // same commit as its own click drops the reader at <body>.
                disabled={!leagueId || loadingTrades}
                className="mt-3 inline-flex h-11 min-h-11 items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 px-4 text-sm font-medium text-ink transition-colors hover:border-brand-purple disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {loadingTrades ? "Loading trades..." : "Load this league"}
              </button>
            </>
          ) : null}

          {leaguesError && (
            <p role="alert" className="mt-2 text-sm text-signal-danger">
              {leaguesError}
            </p>
          )}
          {!loadingLeagues &&
            leaguesLoaded &&
            !leaguesError &&
            leagues.length === 0 && (
              <p role="status" className="mt-2 text-sm text-ink-muted">
                No active leagues found for your Sleeper account this season.
              </p>
            )}
        </div>

        {/* Trade cards */}
        {loadedLeagueId && (
          <div id={TRADE_LIST_ID} className="scroll-mt-24">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink">
                Pick a trade to analyze
              </p>
              {trades.length > 0 && (
                <span className="text-xs text-ink-subtle">
                  {trades.length} completed{" "}
                  {trades.length === 1 ? "trade" : "trades"}
                </span>
              )}
            </div>

            {loadingTrades ? (
              <div
                role="status"
                className="mt-2 flex items-center gap-2 rounded-card border border-line bg-base/40 p-4 text-sm text-ink-muted"
              >
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin text-brand-cyan"
                />
                Loading trades from this league...
              </div>
            ) : tradesError ? (
              <p
                role="alert"
                className="mt-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
              >
                {tradesError}
              </p>
            ) : trades.length === 0 ? (
              <p
                role="status"
                className="mt-2 rounded-card border border-dashed border-line bg-base/40 p-4 text-sm text-ink-muted"
              >
                No completed trades found in this league yet.
              </p>
            ) : (
              <div
                role="group"
                aria-label="Completed trades"
                className="beacon-scroll mt-2 max-h-80 space-y-2 overflow-y-auto rounded-card border border-line bg-base/40 p-2"
              >
                {trades.map((t) => {
                  const selected = t.sleeperTransactionId === selectedTradeId;
                  const busy = selected && analyzing;
                  const weekText = t.week != null ? `Week ${t.week}. ` : "";
                  const cardLabel =
                    t.teams.length === 2
                      ? `Analyze trade. ${weekText}${t.teams[0].teamName} gets ${teamAssetsText(t.teams[0])}. ${t.teams[1].teamName} gets ${teamAssetsText(t.teams[1])}.`
                      : `Analyze trade: ${t.label}`;
                  return (
                    <button
                      key={t.sleeperTransactionId}
                      type="button"
                      aria-pressed={selected}
                      aria-label={cardLabel}
                      onClick={() => pickTrade(t.sleeperTransactionId)}
                      disabled={analyzing}
                      className={`w-full rounded-card border p-3 text-left transition-colors disabled:cursor-not-allowed ${
                        selected
                          ? "border-brand-purple bg-brand-purple/10"
                          : "border-line bg-surface/60 hover:border-brand-cyan/50"
                      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full border border-line bg-base px-2 py-0.5 text-xs text-ink-subtle">
                          {t.week != null ? `Week ${t.week}` : "Trade"}
                        </span>
                        {busy ? (
                          <Loader2
                            aria-hidden="true"
                            className="h-4 w-4 animate-spin text-brand-cyan"
                          />
                        ) : (
                          <ChevronRight
                            aria-hidden="true"
                            className="h-4 w-4 text-ink-subtle"
                          />
                        )}
                      </div>

                      {t.teams.length === 2 ? (
                        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {t.teams[0].teamName}
                            </p>
                            <p className="truncate text-xs text-ink-subtle">
                              gets {teamAssetsText(t.teams[0])}
                            </p>
                          </div>
                          <ArrowLeftRight
                            aria-hidden="true"
                            className="h-4 w-4 text-brand-cyan"
                          />
                          <div className="min-w-0 text-right">
                            <p className="truncate text-sm font-medium text-ink">
                              {t.teams[1].teamName}
                            </p>
                            <p className="truncate text-xs text-ink-subtle">
                              gets {teamAssetsText(t.teams[1])}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 truncate text-sm text-ink">
                          {t.label}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {analyzeError && (
          <p
            role="alert"
            className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
          >
            {analyzeError}
          </p>
        )}

        {notices.length > 0 && (
          <ul role="list" className="space-y-1 text-sm text-ink-muted">
            {notices.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}

        {/* Concise announcement; the full result subtree below is not a live region. */}
        <p aria-live="polite" className="sr-only">
          {analyzing
            ? "Analyzing the imported trade."
            : view
              ? `Result ready. ${view.verdictLabel} Value ${view.isNeutral ? "spread" : "margin"} ${view.marginPct} percent.`
              : ""}
        </p>

        <div
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="Imported trade result"
          className="scroll-mt-24 outline-none"
        >
          {view && (
            <div className="space-y-4">
              <TradeResult
                view={view}
                shareUrl={shareUrl}
                copied={copied}
                onCopy={copyShare}
                assetMeta={assetMeta ?? undefined}
              />

              {!shareUrl && (
                <button
                  type="button"
                  onClick={() => pickTrade(selectedTradeId, true)}
                  disabled={analyzing}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Create share link
                </button>
              )}

              {evidence.length > 0 && (
                <details className="rounded-card border border-line bg-surface/40 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    How we detected your league format
                  </summary>
                  <ul
                    role="list"
                    className="mt-2 space-y-1 text-sm text-ink-muted"
                  >
                    {evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-ink-subtle">
          Your league and team details stay private. They are only shared if you
          create a public link, and even then only the trade summary is shown.
        </p>

        {/* Second way out, for anyone who has scrolled past the first. */}
        <BackBar onBack={onBack} className="" />
      </div>
    </PanelShell>
  );
}

/* ---------- shells / headers ---------- */

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      id="sleeper-import"
      aria-label="Import a trade from Sleeper"
      className="relative overflow-hidden rounded-modal border border-line bg-surface/60 p-5 sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-16 h-44 w-44 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(34,211,238,0.16) 0%, rgba(168,85,247,0.08) 50%, transparent 75%)",
        }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}

function PanelHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-beacon text-black"
      >
        <Sparkles className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
          Sleeper import
        </p>
        <h2 className="mt-0.5 text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

/**
 * The way out. The import panel replaces the trade builder rather than sitting
 * above it, so the route back has to be obvious from every state, not tucked
 * into a corner as an X.
 */
function BackBar({
  onBack,
  className = "mb-4",
}: {
  onBack: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to the trade builder
      </button>
    </div>
  );
}

/* ---------- the save hint ---------- */

/**
 * The one sentence under the save form, for a signed-in reader with nothing
 * saved yet.
 *
 * Deliberately not `SaveHandleNotice state="member-unsaved"`, whose sentence
 * says to tick the save box above. This form has no box: it always saves, for
 * the reason in the panel header. Same visual treatment so the two read as one
 * thing across the site.
 */
function SavedHandleHint() {
  return (
    <p className="mt-4 flex items-start gap-2.5 rounded-card border border-line bg-base/50 p-3 text-sm leading-relaxed text-ink-muted">
      <UserPlus
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
      />
      <span>
        We save this to your account, so every FF Beacon tool opens on your
        leagues from now on. You can change it here or in My Beacon whenever you
        like.
      </span>
    </p>
  );
}
