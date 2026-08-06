"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Search,
  ThumbsDown,
  Trash2,
} from "lucide-react";
import { TradeFinderCard } from "@/components/trade-finder-card";
import { formatEastern } from "@/lib/datetime";
import {
  declineSuggestion,
  findLeagueTrade,
  findPortfolioTrade,
  listSavedSuggestions,
  removeSavedSuggestion,
  saveSuggestion,
  type TradeFinderMeta,
} from "@/app/actions/trade-finder";
import type { SavedTrade } from "@/lib/trade-finder-saves";
import { TRADE_GOALS, type TradeGoal, type TradeSuggestion } from "@/lib/trade-finder/types";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { CrossLeagueSuggestion } from "@/lib/trade-finder-cross-league";

/**
 * Trade Finder, one deal at a time, with a way through the rest of them.
 *
 * WHY ONE ON SCREEN
 *   A list of twenty trades is a spreadsheet, and a spreadsheet is what a
 *   manager opens instead of making a decision. One deal, with the arithmetic
 *   already done, is a decision.
 *
 * WHY THAT USED TO BE A PROBLEM
 *   The engine ranked the whole field and the surface showed the winner, so the
 *   only way to see anything else was "Not interested". That button records a
 *   real opinion and it was also the Next button, which meant a reader who
 *   merely wanted to look past a deal had to declare it refused. And the search
 *   button, labelled "Find another trade", re-ran a deterministic search with
 *   unchanged inputs and handed back the same trade. It looked like navigation
 *   and it was a no-op.
 *
 *   So the three intentions are now three separate things in three places.
 *   Search re-runs the query and lives with the filters that shape it. Previous
 *   and Next move through the shortlist the server already sent, with no round
 *   trip at all. Not interested still means refused, and Save means keep.
 *
 * ONE COMPONENT, TWO SURFACES
 *   `league` mode searches the other teams in one room. `portfolio` mode walks
 *   every league the reader is in, a few at a time, and the card carries the
 *   league name because it is no longer implied by the page. Everything else is
 *   identical, which is the point: there is one Trade Finder.
 *
 * ANNOUNCEMENTS
 *   Every move is a page change a sighted reader sees and a screen reader user
 *   would otherwise miss, so each one is announced in a live region AND focus
 *   moves to the card's heading. That is what makes the arrows and the pass
 *   usable without a mouse: press, and the next deal is where the cursor is.
 *   Save deliberately does NOT move focus, because saving is not navigation.
 */

export type PlayerOption = {
  playerId: string;
  label: string;
  /** The team that holds him, for the acquire picker's option groups. */
  group: string;
};

type AnySuggestion = TradeSuggestion | CrossLeagueSuggestion;

type Tab = "suggestions" | "saved";

export function TradeFinder(props: {
  mode: "league" | "portfolio";
  isSignedIn: boolean;
  /** league mode */
  sleeperLeagueId?: string;
  searchedUsername?: string | null;
  /** Players on the reader's roster, for the "move this player" picker. */
  myPlayers?: PlayerOption[];
  /** Players on every other roster, for the "get this player" picker. */
  theirPlayers?: PlayerOption[];
  /** Rendered on the server so the tab opens on a deal rather than a button. */
  initial?: {
    suggestions: TradeSuggestion[];
    grades: (SuggestionGrade | null)[];
    savedKeys: string[];
    meta: TradeFinderMeta;
  };
  /** portfolio mode */
  sleeperLeagueIds?: string[];
  sleeperUserId?: string | null;
  /** Both modes. Keeps the value source in step with the rest of the page. */
  source?: string | null;
}) {
  const isLeague = props.mode === "league";

  const [goal, setGoal] = useState<TradeGoal>("balanced");
  const [targetPlayerId, setTargetPlayerId] = useState("");
  const [offerPlayerId, setOfferPlayerId] = useState("");

  const [tab, setTab] = useState<Tab>("suggestions");
  const [suggestions, setSuggestions] = useState<AnySuggestion[]>(
    props.initial?.suggestions ?? [],
  );
  const [grades, setGrades] = useState<(SuggestionGrade | null)[]>(
    props.initial?.grades ?? [],
  );
  const [index, setIndex] = useState(0);
  const [savedKeys, setSavedKeys] = useState<string[]>(props.initial?.savedKeys ?? []);
  const [saved, setSaved] = useState<SavedTrade[] | null>(null);
  const [savedIndex, setSavedIndex] = useState(0);

  const [meta, setMeta] = useState<TradeFinderMeta | null>(props.initial?.meta ?? null);
  const [cursor, setCursor] = useState(0);
  /** Portfolio mode: leagues this walk has not opened yet. */
  const [leaguesLeft, setLeaguesLeft] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [savePending, setSavePending] = useState(false);
  /** Passes held for this visit. The only pass list a guest gets. */
  const [sessionExcluded, setSessionExcluded] = useState<string[]>([]);
  /** True once the reader has asked for something, so empty reads as an answer. */
  const [hasSearched, setHasSearched] = useState(Boolean(props.initial));

  const headingId = useId();
  const cardRef = useRef<HTMLElement>(null);
  /** Set when the next render should move focus onto the card. */
  const focusNext = useRef(false);

  useEffect(() => {
    if (!focusNext.current || pending) return;
    focusNext.current = false;
    const heading = cardRef.current?.querySelector<HTMLElement>("[data-card-focus]");
    heading?.focus();
  }, [suggestions, index, saved, savedIndex, tab, pending]);

  const savedSet = useMemo(() => new Set(savedKeys), [savedKeys]);

  const search = useCallback(
    async (excluded: string[], nextCursor: number) => {
      setPending(true);
      setError(null);
      setCopied(false);
      setHasSearched(true);
      setTab("suggestions");
      focusNext.current = true;
      // Said at the START of the search, not only at the end. Two or three
      // seconds of silence after pressing a button is indistinguishable from a
      // button that did nothing.
      setStatus("Searching for trades.");

      try {
        if (isLeague) {
          const res = await findLeagueTrade({
            sleeperLeagueId: props.sleeperLeagueId ?? "",
            username: props.searchedUsername ?? null,
            source: props.source ?? null,
            goal,
            targetPlayerId: targetPlayerId || null,
            offerPlayerId: offerPlayerId || null,
            sessionExcluded: excluded,
          });
          if (!res.ok) {
            setError(res.error);
            setSuggestions([]);
            setGrades([]);
            setStatus(res.error);
            return;
          }
          setSuggestions(res.suggestions);
          setGrades(res.grades);
          setSavedKeys(res.savedKeys);
          setIndex(0);
          setMeta(res.meta);
          setStatus(describeFound(res.suggestions.length));
        } else {
          const res = await findPortfolioTrade({
            sleeperLeagueIds: props.sleeperLeagueIds ?? [],
            sleeperUserId: props.sleeperUserId ?? null,
            source: props.source ?? null,
            goal,
            cursor: nextCursor,
            sessionExcluded: excluded,
          });
          if (!res.ok) {
            setError(res.error);
            setSuggestions([]);
            setGrades([]);
            setStatus(res.error);
            return;
          }
          setSuggestions(res.suggestions);
          setGrades(res.grades);
          setSavedKeys(res.savedKeys);
          setIndex(0);
          setCursor(res.cursor);
          setLeaguesLeft(res.remaining);
          setStatus(
            res.suggestions.length > 0
              ? describeFound(res.suggestions.length)
              : res.remaining > 0
                ? `Nothing in those leagues. ${res.remaining} not searched yet.`
                : "No trade to suggest across your leagues right now.",
          );
        }
      } catch {
        const message = "Something went wrong finding a trade. Try again.";
        setError(message);
        setStatus(message);
      } finally {
        setPending(false);
      }
    },
    [
      goal,
      isLeague,
      offerPlayerId,
      props.searchedUsername,
      props.sleeperLeagueId,
      props.sleeperLeagueIds,
      props.sleeperUserId,
      props.source,
      targetPlayerId,
    ],
  );

  const current = tab === "saved" ? null : (suggestions[index] ?? null);
  const currentGrade = tab === "saved" ? null : (grades[index] ?? null);
  const currentSaved = tab === "saved" ? (saved?.[savedIndex] ?? null) : null;

  // Annotated rather than inferred. CrossLeagueSuggestion is an INTERSECTION of
  // TradeSuggestion and a league block, so an inferred union collapses to the
  // base type by subtype reduction and `"league" in x` stops narrowing.
  const shownSuggestion: AnySuggestion | null =
    current ?? currentSaved?.suggestion ?? null;
  const shownGrade = currentGrade ?? currentSaved?.grade ?? null;
  const leagueIdOf = useCallback(
    (s: AnySuggestion | null, fallbackLeagueId?: string) =>
      s && "league" in s
        ? s.league.sleeperLeagueId
        : (fallbackLeagueId ?? props.sleeperLeagueId ?? ""),
    [props.sleeperLeagueId],
  );
  /**
   * The league a deal belongs to, when the surface does not already imply one.
   *
   * A function rather than an inline check for a type reason: CrossLeagueSuggestion
   * is an INTERSECTION of TradeSuggestion and a league block, so a union of the
   * two narrows cleanly through a typed parameter but not through an inferred
   * local. Portfolio deals carry it; a saved one falls back to the stored name,
   * which is why a bookmark still reads correctly for a league since left.
   */
  const leagueNameOf = useCallback(
    (s: AnySuggestion | null, fallbackName?: string | null) =>
      s && "league" in s ? s.league.name : (fallbackName ?? null),
    [],
  );

  /**
   * Move through the shortlist. Pure client state: the server already sent these.
   */
  const go = useCallback(
    (delta: number) => {
      const list = tab === "saved" ? (saved ?? []) : suggestions;
      const at = tab === "saved" ? savedIndex : index;
      const next = Math.min(Math.max(at + delta, 0), Math.max(0, list.length - 1));
      if (next === at) return;
      focusNext.current = true;
      setCopied(false);
      if (tab === "saved") setSavedIndex(next);
      else setIndex(next);
      setStatus(`Trade ${next + 1} of ${list.length}.`);
    },
    [index, saved, savedIndex, suggestions, tab],
  );

  /**
   * Pass on this deal.
   *
   * The key goes into the local list whether or not the write lands, so a failed
   * or signed-out write still advances rather than handing back the same trade
   * and looking broken. The suggestion is spliced out of what we already hold
   * rather than triggering a fresh search, so a pass is instant and the reader
   * keeps their place in the ranking instead of being sent back to the top.
   */
  const decline = useCallback(async () => {
    if (!current) return;
    const leagueId = leagueIdOf(current);

    const next = [...sessionExcluded, current.key];
    setSessionExcluded(next);

    const remaining = suggestions.filter((_, i) => i !== index);
    const remainingGrades = grades.filter((_, i) => i !== index);
    setSuggestions(remaining);
    setGrades(remainingGrades);
    setIndex((i) => Math.min(i, Math.max(0, remaining.length - 1)));
    setCopied(false);
    focusNext.current = remaining.length > 0;
    setStatus(
      remaining.length > 0
        ? `Passed. Showing trade ${Math.min(index + 1, remaining.length)} of ${remaining.length}.`
        : "Passed. That was the last one we found.",
    );

    if (props.isSignedIn && leagueId) {
      await declineSuggestion({ sleeperLeagueId: leagueId, suggestionKey: current.key });
    }
  }, [current, grades, index, leagueIdOf, props.isSignedIn, sessionExcluded, suggestions]);

  /**
   * Bookmark the deal, or take the bookmark back off it.
   *
   * Deliberately does not move focus or advance: saving is not navigation, and
   * stealing the cursor here would send a keyboard reader somewhere they did not
   * ask to go.
   */
  const toggleSave = useCallback(async () => {
    if (!shownSuggestion || savePending) return;
    const leagueId = leagueIdOf(shownSuggestion, currentSaved?.sleeperLeagueId);
    // On the Saved tab the row IS a bookmark, whatever the key cache says, so
    // the tab is the authority. Trusting the cache alone would let the button
    // read "Remove" and perform a save.
    const isSaved = tab === "saved" || savedSet.has(shownSuggestion.key);
    setSavePending(true);

    try {
      if (isSaved) {
        const res = await removeSavedSuggestion({
          sleeperLeagueId: leagueId,
          suggestionKey: shownSuggestion.key,
        });
        if (!res.ok) {
          setStatus(res.error);
          return;
        }
        setSavedKeys((keys) => keys.filter((k) => k !== shownSuggestion.key));
        const nextSaved = (saved ?? []).filter(
          (s) => s.suggestionKey !== shownSuggestion.key,
        );
        setSaved(nextSaved);
        setSavedIndex((i) => Math.max(0, Math.min(i, nextSaved.length - 1)));
        setStatus(
          nextSaved.length > 0
            ? "Removed from your saved trades."
            : "Removed. You have no saved trades left.",
        );
      } else {
        const res = await saveSuggestion({
          sleeperLeagueId: leagueId,
          leagueName: leagueNameOf(shownSuggestion, currentSaved?.leagueName),
          suggestion: shownSuggestion,
          grade: shownGrade,
        });
        if (!res.ok) {
          setStatus(res.error);
          return;
        }
        setSavedKeys((keys) => [...keys, shownSuggestion.key]);
        // The saved list is refetched next time it is opened rather than being
        // patched here, so it always reflects what the database actually holds.
        setSaved(null);
        setStatus("Saved. It is in your saved trades.");
      }
    } catch {
      setStatus("That did not work. Try again.");
    } finally {
      setSavePending(false);
    }
  }, [
    currentSaved,
    leagueIdOf,
    leagueNameOf,
    saved,
    savePending,
    savedSet,
    shownGrade,
    shownSuggestion,
    tab,
  ]);

  const openSaved = useCallback(async () => {
    setTab("saved");
    setSavedIndex(0);
    setCopied(false);
    if (saved !== null) {
      setStatus(`Saved trades. ${saved.length} ${saved.length === 1 ? "trade" : "trades"}.`);
      return;
    }
    setStatus("Loading your saved trades.");
    const res = await listSavedSuggestions();
    const list = res.ok ? res.saved : [];
    setSaved(list);
    focusNext.current = list.length > 0;
    setStatus(
      list.length > 0
        ? `Saved trades. ${list.length} ${list.length === 1 ? "trade" : "trades"}.`
        : "You have not saved any trades yet.",
    );
  }, [saved]);

  /**
   * Copy the message, not the card.
   *
   * The engine writes `pitch` for the OTHER manager: it opens as a question and
   * says only what the deal does for them. It deliberately omits everything on
   * the card about what the reader gains, because the person receiving it does
   * not care and telling them hands over the reason to say no.
   */
  const copyPitch = useCallback(async () => {
    if (!shownSuggestion) return;
    try {
      await navigator.clipboard.writeText(shownSuggestion.pitch);
      setCopied(true);
      setStatus("Pitch copied. Paste it into your league chat.");
    } catch {
      setStatus(
        "Your browser blocked the copy. Open the message preview on the card and select it instead.",
      );
    }
  }, [shownSuggestion]);

  const list = tab === "saved" ? (saved ?? []) : suggestions;
  const at = tab === "saved" ? savedIndex : index;
  const canGoBack = at > 0;
  const canGoForward = at < list.length - 1;
  const isSaved = shownSuggestion ? savedSet.has(shownSuggestion.key) : false;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(sessionExcluded, isLeague ? 0 : cursor);
        }}
      >
        <fieldset className="rounded-card border border-line bg-surface p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
            What are you after
          </legend>

          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Goal" hint="What the trade has to do for you.">
              {(id, describedBy) => (
                <select
                  id={id}
                  aria-describedby={describedBy}
                  value={goal}
                  onChange={(e) => {
                    setGoal(e.target.value as TradeGoal);
                    // A new goal is a new question, so the portfolio walk starts
                    // over. Continuing from where it stopped would leave every
                    // league already visited unexamined under the new goal.
                    setCursor(0);
                    setLeaguesLeft(null);
                  }}
                  className={SELECT_CLASS}
                >
                  {TRADE_GOALS.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {isLeague && (props.theirPlayers?.length ?? 0) > 0 && (
              <Field label="Player you want" hint="Works out what he would cost.">
                {(id, describedBy) => (
                  <select
                    id={id}
                    aria-describedby={describedBy}
                    value={targetPlayerId}
                    onChange={(e) => setTargetPlayerId(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Anyone</option>
                    {groupOptions(props.theirPlayers ?? [])}
                  </select>
                )}
              </Field>
            )}

            {isLeague && (props.myPlayers?.length ?? 0) > 0 && (
              <Field label="Player you would move" hint="Shows what he brings back.">
                {(id, describedBy) => (
                  <select
                    id={id}
                    aria-describedby={describedBy}
                    value={offerPlayerId}
                    onChange={(e) => setOfferPlayerId(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Anyone</option>
                    {groupOptions(props.myPlayers ?? [])}
                  </select>
                )}
              </Field>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* Says what it does. This used to read "Find another trade" and
                re-ran a deterministic search with unchanged inputs, which handed
                back the trade already on screen. */}
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2 text-sm font-bold text-black shadow-[0_0_24px_-10px_rgba(168,85,247,0.9)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Search aria-hidden="true" className="h-4 w-4" />
              )}
              {hasSearched ? "Search with these settings" : "Find me a trade"}
            </button>
            <p className="text-xs text-ink-muted">
              {isLeague
                ? "Runs the search again. Use the arrows below to move between the trades it found."
                : leaguesLeft !== null && leaguesLeft > 0
                  ? `Searches the next ${leaguesLeft === 1 ? "league" : "leagues"}. ${leaguesLeft} to go.`
                  : "Runs the search again across your leagues."}
            </p>
          </div>
        </fieldset>
      </form>

      {/* Every result, move, pass, and save lands here. Polite so it waits for
          the reader to finish what they were reading rather than cutting in. */}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <TabButton
          active={tab === "suggestions"}
          onClick={() => {
            setTab("suggestions");
            setCopied(false);
            setStatus(
              suggestions.length > 0
                ? `Suggestions. Trade ${index + 1} of ${suggestions.length}.`
                : "Suggestions.",
            );
          }}
        >
          Suggestions
        </TabButton>
        {props.isSignedIn ? (
          <TabButton active={tab === "saved"} onClick={() => void openSaved()}>
            Saved{savedKeys.length > 0 ? ` (${savedKeys.length})` : ""}
          </TabButton>
        ) : (
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-card border border-dashed border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sign in to save trades
          </Link>
        )}
      </div>

      {pending && (
        <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
          Working through the rosters.
        </p>
      )}

      {!pending && error && (
        <p
          role="alert"
          className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
        >
          {error}
        </p>
      )}

      {!pending && !error && shownSuggestion && (
        // A named region, labelled by the card's own headline, so the deal is
        // one thing a screen reader can jump to and step out of rather than a
        // run of paragraphs between two buttons.
        <section ref={cardRef} aria-labelledby={headingId} className="space-y-3">
          {/* Position first, so a reader knows where they are before they read
              the deal. It is real text rather than an aria-only string, because
              a sighted reader needs to know there are eleven more just as much. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={!canGoBack}
              className={NAV_BUTTON_CLASS}
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              Previous
            </button>
            <p className="text-sm font-semibold tabular-nums text-ink">
              Trade {at + 1} of {list.length}
            </p>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={!canGoForward}
              className={NAV_BUTTON_CLASS}
            >
              Next
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
            {tab === "suggestions" && (meta?.beyondWindow ?? 0) > 0 && (
              <p className="text-xs text-ink-muted">
                {meta?.beyondWindow} more behind these
              </p>
            )}
          </div>

          {/* tabIndex -1 makes this a focus target without putting it in the tab
              order; focus lands here after every move. It keeps a visible ring
              rather than outline-none, because a sighted keyboard user needs to
              see where focus went just as much as anyone else. */}
          <div
            data-card-focus
            tabIndex={-1}
            className="rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <TradeFinderCard
              suggestion={shownSuggestion}
              grade={shownGrade}
              sleeperLeagueId={leagueIdOf(shownSuggestion, currentSaved?.sleeperLeagueId)}
              searchedUsername={props.searchedUsername ?? null}
              headingId={headingId}
              leagueLabel={leagueNameOf(shownSuggestion, currentSaved?.leagueName)}
            />
          </div>

          {currentSaved && (
            <p className="text-xs text-ink-muted">
              Saved {formatEastern(currentSaved.savedAtIso)}. Player values are as
              they were then.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyPitch()}
              className={ACTION_BUTTON_CLASS}
            >
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-signal-success" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy the pitch"}
            </button>

            {props.isSignedIn ? (
              <button
                type="button"
                onClick={() => void toggleSave()}
                disabled={savePending}
                className={ACTION_BUTTON_CLASS}
              >
                {tab === "saved" ? (
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                ) : isSaved ? (
                  <BookmarkCheck aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                ) : (
                  <Bookmark aria-hidden="true" className="h-4 w-4" />
                )}
                {tab === "saved" ? "Remove" : isSaved ? "Saved" : "Save for later"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center gap-2 rounded-card border border-dashed border-line px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Bookmark aria-hidden="true" className="h-4 w-4" />
                Sign in to bookmark this trade
              </Link>
            )}

            {tab === "suggestions" && (
              <button
                type="button"
                onClick={() => void decline()}
                className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-purple/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <ThumbsDown aria-hidden="true" className="h-4 w-4" />
                Not interested
              </button>
            )}
          </div>

          {tab === "suggestions" && (
            <p className="text-xs text-ink-muted">
              Not interested hides a trade for two weeks.{" "}
              {props.isSignedIn ? "" : "Signed out, that lasts this visit only."}
            </p>
          )}
        </section>
      )}

      {!pending && !error && !shownSuggestion && tab === "saved" && saved !== null && (
        <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
          <p className="text-base font-semibold text-ink">No saved trades yet.</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            Press Save for later on a suggestion and it will be here, exactly as it
            was shown, whenever you come back.
          </p>
        </div>
      )}

      {!pending && !error && !shownSuggestion && tab === "suggestions" && hasSearched && (
        <EmptyState
          mode={props.mode}
          meta={meta}
          leaguesLeft={leaguesLeft}
          declinedAll={sessionExcluded.length > 0}
        />
      )}
    </div>
  );
}

function describeFound(count: number): string {
  if (count === 0) return "No trade to suggest with these settings.";
  return count === 1
    ? "Found one trade."
    : `Found ${count} trades. Showing trade 1 of ${count}. Use Previous and Next to move between them.`;
}

const SELECT_CLASS =
  "min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

const NAV_BUTTON_CLASS =
  "inline-flex min-h-11 items-center gap-1 rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50";

const ACTION_BUTTON_CLASS =
  "inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";

/**
 * Two buttons rather than a tablist.
 *
 * A tablist promises arrow-key navigation between the tabs and a matching set of
 * tabpanels, and this is two toggles over one region. `aria-pressed` says what
 * is actually true: one of them is currently on.
 */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center rounded-card border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
        active
          ? "border-brand-cyan/60 bg-brand-cyan/10 text-ink"
          : "border-line bg-surface text-ink-muted hover:border-brand-cyan/40 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Options grouped by the team that holds each player. */
function groupOptions(options: PlayerOption[]) {
  const groups = new Map<string, PlayerOption[]>();
  for (const option of options) {
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }
  return [...groups.entries()].map(([group, list]) => (
    <optgroup key={group} label={group}>
      {list.map((option) => (
        <option key={option.playerId} value={option.playerId}>
          {option.label}
        </option>
      ))}
    </optgroup>
  ));
}

/**
 * A labelled control with its hint wired up.
 *
 * The hint is real guidance rather than decoration, so it is joined to the
 * control with aria-describedby instead of sitting beside it as text a screen
 * reader user would have to go looking for.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: (id: string, describedBy: string) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <p id={hintId} className="mt-0.5 text-xs text-ink-muted">
        {hint}
      </p>
      <div className="mt-1.5">{children(id, hintId)}</div>
    </div>
  );
}

/**
 * Nothing to show.
 *
 * Says WHY, because "no results" on a feature like this reads as a broken
 * feature. The four real reasons are a league nobody has synced, a portfolio we
 * have already walked to the end of, a shortlist the reader has passed their way
 * through, and a genuine answer of no: every trade the engine could build either
 * helps nobody or would be laughed at.
 */
function EmptyState({
  mode,
  meta,
  leaguesLeft,
  declinedAll,
}: {
  mode: "league" | "portfolio";
  meta: TradeFinderMeta | null;
  leaguesLeft: number | null;
  declinedAll: boolean;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
      <p className="text-base font-semibold text-ink">
        {declinedAll ? "That is everything we found." : "No trade to suggest right now."}
      </p>
      {mode === "league" ? (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {declinedAll
            ? "Search again for a fresh set, or change the goal to look at different kinds of deal."
            : meta && meta.consideredTeams === 0
              ? "No other team has a piece it would move yet."
              : "Everything we could build either does nothing for you or would be refused. Try a different goal, or name a player you want."}
        </p>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {leaguesLeft && leaguesLeft > 0
            ? "Nothing in those leagues. Search again for the rest."
            : "Every league we can read has been searched."}
        </p>
      )}
      {meta?.lineupUnavailable && (
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          No projections loaded yet, so trades here are measured on value alone.
        </p>
      )}
    </div>
  );
}
