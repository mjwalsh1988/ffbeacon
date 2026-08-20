"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronRight,
  Loader2,
  LogIn,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStepScroll } from "@/lib/use-step-scroll";
import {
  mergeSleeperLeagueSettings,
  parseSleeperLeagueSettings,
} from "@/lib/sleeper-league-settings";
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
  if (t.playerCount > 0) parts.push(`${t.playerCount} player${t.playerCount === 1 ? "" : "s"}`);
  if (t.pickCount > 0) parts.push(`${t.pickCount} pick${t.pickCount === 1 ? "" : "s"}`);
  return parts.join(", ") || "nothing";
}

/**
 * Inline Sleeper import for the Signal Check page. Adapts to auth state:
 *  - signed out: a notice inviting sign-in
 *  - signed in, no saved username: a small inline form to save it
 *  - signed in with username: pick a league, then pick a trade card, which
 *    imports and analyzes it right here (no separate page).
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
  const [username, setUsername] = useState<string | null>(initialUsername);

  const [leagues, setLeagues] = useState<ImportLeague[]>([]);
  const [leaguesLoaded, setLeaguesLoaded] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [loadingLeagues, startLeagues] = useTransition();

  const [leagueId, setLeagueId] = useState("");
  const [trades, setTrades] = useState<ImportTrade[]>([]);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [loadingTrades, startTrades] = useTransition();

  const [selectedTradeId, setSelectedTradeId] = useState("");
  const [view, setView] = useState<BuilderView | null>(null);
  const [assetMeta, setAssetMeta] = useState<ResultAssetMetaBySide | null>(null);
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
  useStepScroll(leagueId || null, { id: TRADE_LIST_ID });

  function loadLeagues() {
    setLeaguesError(null);
    startLeagues(async () => {
      const res = await listImportLeagues();
      if (res.ok) {
        setLeagues(res.leagues);
        setLeaguesLoaded(true);
        if (res.leagues.length === 1) selectLeague(res.leagues[0].sleeperLeagueId);
      } else {
        if (res.needsUsername) setUsername(null);
        setLeaguesError(res.error);
        setLeaguesLoaded(true);
      }
    });
  }

  // The panel only mounts once the reader asks for it, so load the league list
  // as soon as we have a username to load it with.
  useEffect(() => {
    if (username && !leaguesLoaded && !loadingLeagues) loadLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, leaguesLoaded]);

  function resetResult() {
    setView(null);
    setAssetMeta(null);
    setShareUrl(null);
    setEvidence([]);
    setNotices([]);
    setAnalyzeError(null);
  }

  function selectLeague(id: string) {
    setLeagueId(id);
    setTrades([]);
    setTradesError(null);
    setSelectedTradeId("");
    resetResult();
    if (!id) return;
    startTrades(async () => {
      const res = await listLeagueTrades(id);
      if (res.ok) setTrades(res.trades);
      else setTradesError(res.error);
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
      </PanelShell>
    );
  }

  // ---- Signed in, no username: inline save form ------------------------
  if (!username) {
    return (
      <PanelShell>
        <BackBar onBack={onBack} />
        <PanelHeader
          title="First, connect your Sleeper username"
          description="We use your saved handle to find your leagues. We never post anything to Sleeper, and your league details stay private."
        />
        <div className="mt-4">
          <UsernameSaveForm
            onSaved={(value) => {
              setUsername(value);
              setLeaguesLoaded(false);
            }}
          />
        </div>
      </PanelShell>
    );
  }

  // ---- Signed in, username present: league + trade picker --------------
  return (
    <PanelShell>
      <BackBar onBack={onBack} />
      <PanelHeader
        title="Import a completed trade"
        description="Choose a league, then tap the trade you want to analyze. We detect the league format automatically."
      />

      <div className="mt-5 space-y-5">
        {/* League select */}
        <div>
          <label htmlFor="sc-import-league" className="block text-sm font-medium text-ink">
            Your Sleeper league
          </label>
          <div className="mt-2 flex items-center gap-2">
            <select
              id="sc-import-league"
              value={leagueId}
              onChange={(e) => selectLeague(e.target.value)}
              disabled={loadingLeagues}
              className="min-h-11 w-full max-w-md rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <option value="">
                {loadingLeagues ? "Loading your leagues..." : "Select a league"}
              </option>
              {leagues.map((l) => (
                <option key={l.sleeperLeagueId} value={l.sleeperLeagueId}>
                  {l.name} ({l.season})
                </option>
              ))}
            </select>
          </div>
          {leaguesError && (
            <p role="alert" className="mt-2 text-sm text-signal-danger">
              {leaguesError}
            </p>
          )}
          {!loadingLeagues && leaguesLoaded && !leaguesError && leagues.length === 0 && (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              No active leagues found for your Sleeper account this season.
            </p>
          )}
        </div>

        {/* Trade cards */}
        {leagueId && (
          <div id={TRADE_LIST_ID} className="scroll-mt-24">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink">Pick a trade to analyze</p>
              {trades.length > 0 && (
                <span className="text-xs text-ink-subtle">
                  {trades.length} completed {trades.length === 1 ? "trade" : "trades"}
                </span>
              )}
            </div>

            {loadingTrades ? (
              <div role="status" className="mt-2 flex items-center gap-2 rounded-card border border-line bg-base/40 p-4 text-sm text-ink-muted">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-brand-cyan" />
                Loading trades from this league...
              </div>
            ) : tradesError ? (
              <p role="alert" className="mt-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
                {tradesError}
              </p>
            ) : trades.length === 0 ? (
              <p role="status" className="mt-2 rounded-card border border-dashed border-line bg-base/40 p-4 text-sm text-ink-muted">
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
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-brand-cyan" />
                        ) : (
                          <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-subtle" />
                        )}
                      </div>

                      {t.teams.length === 2 ? (
                        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{t.teams[0].teamName}</p>
                            <p className="truncate text-xs text-ink-subtle">gets {teamAssetsText(t.teams[0])}</p>
                          </div>
                          <ArrowLeftRight aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                          <div className="min-w-0 text-right">
                            <p className="truncate text-sm font-medium text-ink">{t.teams[1].teamName}</p>
                            <p className="truncate text-xs text-ink-subtle">gets {teamAssetsText(t.teams[1])}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 truncate text-sm text-ink">{t.label}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {analyzeError && (
          <p role="alert" className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
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
                  <ul role="list" className="mt-2 space-y-1 text-sm text-ink-muted">
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
          Your league and team details stay private. They are only shared if you create a public
          link, and even then only the trade summary is shown.
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

function PanelHeader({ title, description }: { title: string; description: string }) {
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
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
      </div>
    </div>
  );
}

/**
 * The way out. The import panel replaces the trade builder rather than sitting
 * above it, so the route back has to be obvious from every state, not tucked
 * into a corner as an X.
 */
function BackBar({ onBack, className = "mb-4" }: { onBack: () => void; className?: string }) {
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

/* ---------- inline username save ---------- */

function UsernameSaveForm({ onSaved }: { onSaved: (username: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cleaned = value.trim();
    if (cleaned.length === 0) {
      setError("Enter your Sleeper username.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You are not signed in.");
        return;
      }
      // Read-merge-write so other keys in the jsonb are preserved.
      const { data: existing } = await supabase
        .from("user_preferences")
        .select("sleeper_league_settings")
        .eq("user_id", user.id)
        .maybeSingle();
      const current = parseSleeperLeagueSettings(existing?.sleeper_league_settings);
      const next = mergeSleeperLeagueSettings(current, { username: cleaned });
      const { error: upsertError } = await supabase.from("user_preferences").upsert(
        {
          user_id: user.id,
          sleeper_league_settings: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (upsertError) {
        setError(upsertError.message);
        return;
      }
      onSaved(cleaned);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <label htmlFor="sc-import-username" className="block text-sm font-medium text-ink">
          Sleeper username
        </label>
        <input
          id="sc-import-username"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your-handle"
          className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
        )}
        {pending ? "Saving..." : "Save and continue"}
      </button>
      <p aria-live="polite" className="min-h-[1.25rem] text-sm sm:col-span-2">
        {error && (
          <span role="alert" className="text-signal-danger">
            {error}
          </span>
        )}
      </p>
    </form>
  );
}
