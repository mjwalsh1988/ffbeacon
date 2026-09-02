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
  Layers,
  Lightbulb,
  Loader2,
  Search,
  SearchX,
  SlidersHorizontal,
  ThumbsDown,
  Trash2,
} from "lucide-react";
import { TradeFinderCard } from "@/components/trade-finder-card";
import { type PlayerOption } from "@/components/player-picker";
import { PlayerPackagePicker } from "@/components/trade-ideas/player-package-picker";
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
import { proposalHref } from "@/lib/trade-impact/proposal-url";
import type { BuildAsset } from "@/lib/trade-impact/types";
import type { PositionalWarContext } from "@/lib/trade-impact/asset-notes";
import { PositionFilter } from "@/components/trade-ideas/position-filter";
import { SuggestionEvaluation } from "@/components/trade-ideas/suggestion-evaluation";
import {
  MAX_NAMED_PLAYERS,
  TRADE_POSITION_LABEL,
  TRADE_STRATEGIES,
  type SuggestionAsset,
  type TradePosition,
  type TradeStrategy,
  type TradeSuggestion,
} from "@/lib/trade-finder/types";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { CrossLeagueSuggestion } from "@/lib/trade-finder-cross-league";

/**
 * The suggestion browser for Trade Ideas: one deal at a time, with a way
 * through the rest of them.
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
 *   trip at all. Pass still means refused, and Save means keep.
 *
 * WHAT THE FILTERS ASK FOR
 *   Three questions, narrowing as they go: WHAT THE RANKING SHOULD CHASE, the
 *   POSITION GROUPS on each side, and NAMED PLAYERS on each side. They are
 *   ordered that way on screen because that is the order of specificity, and the
 *   engine resolves conflicts the same way: a named player settles the side he
 *   is on and stands the position ask on that side down, because "get me this
 *   quarterback" and "get me a running back" cannot both be honoured and the
 *   name is the more specific request. The ask on the OTHER side survives, which
 *   is the combination managers actually type.
 *
 *   The first question used to name five SHAPES of deal in a select
 *   (consolidate, split, collect picks, get younger, or nothing). It was the
 *   wrong question. A manager opening this tab has already decided whether they
 *   are trying to win in December or trying to win the trade, and those two
 *   answers order the same league completely differently; the shape of the
 *   package is downstream of that and mostly not something anyone has an opinion
 *   about in advance. So it is two options now, Contender and Value, and in a
 *   REDRAFT league nobody is asked: nothing carries over, so a deal
 *   that costs points a week is simply wrong there and the engine refuses to
 *   build one rather than ranking it lower.
 *
 *   Each name row takes a LIST, and the list is a package rather than a
 *   shortlist: every player named on a side has to be in the deal on that side.
 *   "These two backs, together, for a receiver" is one question, and asking it
 *   one player at a time gets two answers, neither of which is the trade.
 *
 *   Nothing auto-searches. A chip press is cheap and a search is a few hundred
 *   lineup fills, so pressing four chips must not run four searches; the live
 *   region says "press Search to apply" after every one of them.
 *
 * ONE COMPONENT, TWO SURFACES
 *   `league` mode searches the other teams in one room. `portfolio` mode walks
 *   every league the reader is in, a few at a time, and the card carries the
 *   league name because it is no longer implied by the page. Everything else is
 *   identical, which is the point: there is one suggestion browser.
 *
 * ANNOUNCEMENTS
 *   Every move is a page change a sighted reader sees and a screen reader user
 *   would otherwise miss, so each one is announced in a live region AND focus
 *   moves to the card's heading. That is what makes the arrows and the pass
 *   usable without a mouse: press, and the next deal is where the cursor is.
 *   Save deliberately does NOT move focus, because saving is not navigation.
 */

/**
 * Re-exported so the page that builds these lists keeps importing them from the
 * component it hands them to, rather than reaching past it into the picker.
 */
export type { PlayerOption };

type AnySuggestion = TradeSuggestion | CrossLeagueSuggestion;

/**
 * One suggested asset, as the builder's URL wants it.
 *
 * A pick loses its slot bucket on the way through, and that is correct rather
 * than lossy. `SuggestionAsset` carries no `pickPosition`, and the evaluator
 * matches a proposed pick against a roster on season and round alone, because
 * the bucket is our own estimate rather than the league's fact. "mid" is what
 * lib/league-pick-position.ts falls back to when a slot is unknown, so using it
 * here keeps one answer for an unknown slot across the whole feature.
 */
function toBuildAsset(asset: SuggestionAsset): BuildAsset {
  if (asset.kind === "player") return { kind: "player", playerId: asset.playerId };
  return {
    kind: "pick",
    season: asset.season,
    round: asset.round,
    pickPosition: "mid",
  };
}

type Tab = "suggestions" | "saved";

export function TradeFinder(props: {
  mode: "league" | "portfolio";
  isSignedIn: boolean;
  /** league mode */
  sleeperLeagueId?: string;
  searchedUsername?: string | null;
  /**
   * The reader's own team name, as formatTeamLabel renders it.
   *
   * Only needed by the full evaluation, which names both sides of the deal.
   * Absent in portfolio mode, where no evaluation runs.
   */
  myTeamName?: string | null;
  /** Players on the reader's roster, for the "move this player" picker. */
  myPlayers?: PlayerOption[];
  /** Players on every other roster, for the "get this player" picker. */
  theirPlayers?: PlayerOption[];
  /**
   * Whether assets carry past this season.
   *
   * Decides whether the strategy toggle is a question at all. A one-year league
   * is never asked it, because the other answer is wrong there rather than
   * merely different: a pile of trade value that scores no points expires in
   * January. Absent (portfolio mode) is read as dynasty, which is where the
   * toggle is a real choice.
   */
  isDynasty?: boolean;
  /**
   * Which side of the toggle to open on, in a dynasty league.
   *
   * The page reads it off Power Pulse's call on the reader's own team, so a
   * rebuilder opens on Value and a contender on Contender. It is a starting
   * position and nothing more: the toggle is right there and moving it is one
   * press.
   */
  defaultStrategy?: TradeStrategy;
  /**
   * The position groups this league actually rosters, in display order.
   *
   * Passed in rather than assumed, so a league with no kicker slot is never
   * offered a kicker chip whose only possible answer is "no trade found".
   * Absent or empty (portfolio mode) hides the position rows entirely.
   */
  availablePositions?: TradePosition[];
  /**
   * The reader's own Sleeper roster id in THIS league. Only the league page
   * knows it, and without it a deal cannot be handed to the builder, because
   * the builder has to be told which side of it belongs to the reader.
   */
  myRosterId?: number | null;
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
  /**
   * Positional WAR for this league season, keyed by Sleeper id. League mode
   * only; portfolio mode spans leagues, so there is no one curve to read.
   * Read only, loaded once by the page (lib/trade-impact/positional-war-context.ts)
   * and handed down for the evaluation card's asset notes.
   */
  positionalWarByPlayer?: Map<string, PositionalWarContext>;
}) {
  const isLeague = props.mode === "league";

  /**
   * Which question the ranking answers.
   *
   * Seeded by the page rather than hardcoded, because the right opening answer
   * depends on the reader: a dynasty team Power Pulse has out of the race opens
   * on Value, one chasing January opens on Contender. In a REDRAFT league there
   * is no choice to seed, the toggle is not rendered, and this stays on
   * "contender" for the whole visit.
   */
  const [strategy, setStrategy] = useState<TradeStrategy>(
    props.isDynasty === false ? "contender" : (props.defaultStrategy ?? "contender"),
  );
  const [targetPlayerIds, setTargetPlayerIds] = useState<string[]>([]);
  const [offerPlayerIds, setOfferPlayerIds] = useState<string[]>([]);
  const [wantPositions, setWantPositions] = useState<TradePosition[]>([]);
  const [givePositions, setGivePositions] = useState<TradePosition[]>([]);

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
  const filtersId = useId();
  const strategyLabelId = useId();
  const passNoteId = useId();
  const evaluationId = useId();
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

  /**
   * Whether the reader gets a choice about what the ranking measures.
   *
   * Only in a dynasty league. Portfolio mode spans rooms of both kinds and has
   * no single league to read, so the toggle stands and each league resolves it
   * for itself: a redraft room in the walk ranks as a contender search whatever
   * the toggle says. See resolveStrategy.
   */
  const showStrategy = props.isDynasty !== false;

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
            strategy,
            targetPlayerIds,
            offerPlayerIds,
            wantPositions,
            givePositions,
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
          // On an empty result the notice is the ONLY sentence that says
          // anything the reader can act on: which chip to move, or that the
          // package is too big to price. Announcing the generic line instead
          // and leaving the diagnosis in a paragraph gives a screen reader
          // user the half that does not help.
          setStatus(
            res.suggestions.length === 0 && res.meta.notice
              ? res.meta.notice
              : describeFound(res.suggestions.length),
          );
        } else {
          const res = await findPortfolioTrade({
            sleeperLeagueIds: props.sleeperLeagueIds ?? [],
            sleeperUserId: props.sleeperUserId ?? null,
            source: props.source ?? null,
            strategy,
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
      givePositions,
      isLeague,
      offerPlayerIds,
      props.searchedUsername,
      props.sleeperLeagueId,
      props.sleeperLeagueIds,
      props.sleeperUserId,
      props.source,
      strategy,
      targetPlayerIds,
      wantPositions,
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
   * Where this deal opens in the builder, or null when it cannot.
   *
   * Null in two cases that both matter. On the portfolio panel a deal can come
   * out of any league the reader is in and there is no roster id held for any of
   * them, so there is nothing to open. And a bookmark can name a league the
   * reader has since left, whose page would ask "which team is yours?" all over
   * again. Both drop the control rather than drawing a link that goes somewhere
   * wrong.
   */
  const builderHrefOf = useCallback(
    (s: AnySuggestion | null, leagueId: string): string | null => {
      const myRosterId = props.myRosterId;
      if (!s || myRosterId === null || myRosterId === undefined) return null;
      if (!leagueId || leagueId !== props.sleeperLeagueId) return null;
      return proposalHref(
        leagueId,
        {
          myRosterId,
          theirRosterId: s.counterparty.rosterId,
          incoming: s.incoming.map(toBuildAsset),
          outgoing: s.outgoing.map(toBuildAsset),
        },
        {
          searchedUsername: props.searchedUsername ?? null,
          source: props.source ?? null,
        },
      );
    },
    [props.myRosterId, props.searchedUsername, props.sleeperLeagueId, props.source],
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
        // The league block is stripped before posting. A portfolio suggestion is
        // a TradeSuggestion plus a `league` field, and the save schema is strict,
        // so posting it whole meant every bookmark taken from the cross-league
        // panel was rejected and the reader was told the trade could not be
        // saved with no way to work out why. The league is carried alongside in
        // `sleeperLeagueId` and `leagueName`, which is where the row keeps it.
        const { league: _league, ...snapshot } =
          shownSuggestion as AnySuggestion & { league?: unknown };
        const res = await saveSuggestion({
          sleeperLeagueId: leagueId,
          leagueName: leagueNameOf(shownSuggestion, currentSaved?.leagueName),
          suggestion: snapshot,
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

  /**
   * The position rows, and what they are allowed to offer.
   *
   * Hidden below two groups, because a league that rosters one position has
   * nothing to choose between and a filter with a single option is a control
   * that can only be wrong. Portfolio mode has no single league to read a roster
   * shape from, so it never draws them.
   */
  const positionsAvailable = props.availablePositions ?? [];
  const showPositions = isLeague && positionsAvailable.length > 1;

  /**
   * Toggle one group, keeping the list in the league's own display order.
   *
   * Rebuilt from `positionsAvailable` rather than appended to, so the order
   * never depends on which chip was pressed first. That matters past the
   * cosmetic: the rationale sentence on the card is assembled from this list.
   */
  const nextPositions = (
    list: TradePosition[],
    position: TradePosition,
  ): TradePosition[] =>
    positionsAvailable.filter((p) =>
      p === position ? !list.includes(p) : list.includes(p),
    );

  /**
   * The deal on screen, in the shape the evaluator takes, or null.
   *
   * Null is the same condition that drops the builder link, and for the same
   * reasons: a portfolio deal can come out of any league and holds no roster id
   * for it, and a bookmark can name a league the reader has since left. Neither
   * can be evaluated against a roster, so neither is.
   *
   * Memoised on the suggestion object, not rebuilt per render, because the arrays
   * inside it are the evaluator's identity for the request it is about to make.
   */
  const shownProposal = useMemo(() => {
    const myRosterId = props.myRosterId;
    if (!shownSuggestion || myRosterId === null || myRosterId === undefined) return null;
    const leagueId = leagueIdOf(shownSuggestion, currentSaved?.sleeperLeagueId);
    if (!leagueId || leagueId !== props.sleeperLeagueId) return null;
    return {
      leagueId,
      myRosterId,
      theirRosterId: shownSuggestion.counterparty.rosterId,
      incoming: shownSuggestion.incoming.map(toBuildAsset),
      outgoing: shownSuggestion.outgoing.map(toBuildAsset),
    };
  }, [
    currentSaved?.sleeperLeagueId,
    leagueIdOf,
    props.myRosterId,
    props.sleeperLeagueId,
    shownSuggestion,
  ]);

  /** Said out loud on every chip press, because nothing else changes on screen. */
  const announceToggle = (
    position: TradePosition,
    added: boolean,
    side: "get" | "give",
  ) => {
    setStatus(
      `${TRADE_POSITION_LABEL[position]} ${added ? "added to" : "removed from"} what you ${side}. Press Search to apply.`,
    );
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(sessionExcluded, isLeague ? 0 : cursor);
        }}
      >
        {/* A framed tray with a header band, the shape every other control group
            on the site wears (components/dashboard-panel.tsx). It was a bare
            fieldset whose legend floated on the border, which reads as a caption
            rather than as the top of a container, and the tiers inside ran
            together with no seam between one question and the next. */}
        <section
          aria-labelledby={filtersId}
          className="overflow-hidden rounded-modal border border-line bg-surface/50"
        >
          <div className="flex items-center gap-2 border-b border-line bg-surface-elevated/50 px-4 py-3">
            <SlidersHorizontal
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-brand-cyan"
            />
            <h3
              id={filtersId}
              className="text-[13px] font-bold uppercase tracking-[0.16em] text-ink"
            >
              What you are after
            </h3>
          </div>

          <div className="divide-y divide-line">
            <div className="px-4 py-3.5">
              {/* WHAT THE RANKING MEASURES.

                  This was a five-option select naming SHAPES of deal
                  (consolidate, split, collect picks, get younger). It asked the
                  wrong question. A manager opening this tab is not thinking
                  about the shape of a package, they are thinking about whether
                  they are trying to win in December or trying to win the trade,
                  and those two answers order the same league completely
                  differently.

                  Two buttons rather than a select, because there are two
                  answers and both fit on screen. A select hides one of them
                  behind an interaction and reads the chosen one back as a value
                  rather than as a choice; a radio group says out loud that
                  there are two and which one is on.

                  Not rendered at all in a redraft league. There the answer
                  follows from the league rather than from a preference, and
                  offering a toggle whose other position the engine would ignore
                  is worse than offering none. The sentence in its place says
                  why. */}
              {showStrategy ? (
                // A real fieldset of real radios, drawn as a segmented strip.
                //
                // Not role="radiogroup" over two buttons, which is the shape
                // this wants to be and the one that ships broken: ARIA says a
                // radio group is arrow-navigable, and two buttons with
                // aria-checked are not, so a keyboard reader meets a control
                // that announces itself as a radio group and then refuses to
                // behave like one. Native inputs get arrow keys, the
                // one-tab-stop-per-group rule, and the platform's own
                // announcement, for free and in every screen reader.
                //
                // The input is not display:none. A hidden input is not
                // focusable, which would take the whole group out of the tab
                // order; it is drawn under its label with peer- styling.
                <fieldset className="min-w-0 border-0 p-0">
                  <legend className="block p-0 text-sm font-semibold text-ink">
                    What the ranking should chase
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-1.5 rounded-card border border-line bg-base/40 p-1.5">
                    {TRADE_STRATEGIES.map((option) => (
                      <div key={option.key} className="relative min-w-[8rem] flex-1">
                        <input
                          type="radio"
                          id={`${strategyLabelId}-${option.key}`}
                          name={`${strategyLabelId}-strategy`}
                          value={option.key}
                          checked={strategy === option.key}
                          onChange={() => {
                            setStrategy(option.key);
                            // A different question, so the portfolio walk starts
                            // over rather than resuming with leagues already
                            // visited under the old one.
                            setCursor(0);
                            setLeaguesLeft(null);
                            // Just the instruction. The radio's own accessible
                            // name already carried the label and the blurb, and
                            // repeating the blurb here read the longest part of
                            // it twice in a row on every arrow press.
                            setStatus(`${option.label} selected. Press Search to apply.`);
                          }}
                          className="peer absolute h-px w-px overflow-hidden opacity-0"
                        />
                        <label
                          htmlFor={`${strategyLabelId}-${option.key}`}
                          // The transparent border is a placeholder that stops
                          // the checked state from shifting the layout. It is
                          // also the only thing that survives forced-colors
                          // mode: `bg-beacon` is a background IMAGE and the
                          // real radio is a 1px transparent square, so with
                          // background images stripped both options would look
                          // identical and nothing on screen would say which is
                          // on.
                          className="flex min-h-11 cursor-pointer items-center justify-center rounded-card border border-transparent px-3 py-2 text-center text-sm font-bold text-ink-muted transition-colors hover:bg-surface-elevated/60 hover:text-ink peer-checked:bg-beacon peer-checked:text-black peer-checked:shadow-[0_0_20px_-10px_rgba(168,85,247,0.9)] peer-checked:forced-colors:border-[Highlight] peer-checked:forced-colors:text-[Highlight] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-cyan"
                        >
                          {/* The label a sighted reader sees, then the
                              difference between the two options, which is the
                              part they cannot infer from one word. Read out on
                              every arrow press, which is the moment it is
                              needed; a hint under the group is read once, on
                              arrival, and by then the reader has not yet met
                              either option. */}
                          {option.label}
                          <span className="sr-only">: {option.blurb}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  {/* What the choice currently in force actually does. Outside
                      the group and not wired to it with aria-describedby: it
                      changes as the selection changes, so attaching it to each
                      radio would read the OLD sentence on the press that
                      replaced it. */}
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {strategy === "contender"
                      ? "Only deals that add points to your starting lineup, ranked by what those points are worth in wins."
                      : "Ranked by what the pieces are worth in this league's format, including youth and draft capital."}
                  </p>
                </fieldset>
              ) : (
                <>
                  <span className="block text-sm font-semibold text-ink">
                    What the ranking chases
                  </span>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    This is a one-year league, so every suggestion has to add
                    points to your starting lineup. Deals that cost you points a
                    week are left out rather than ranked lower.
                  </p>
                </>
              )}
            </div>

            {/* POSITIONS. Two rows rather than one control, because they are two
                independent asks and a reader routinely sets only one of them. */}
            {showPositions && (
              <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2">
                <PositionFilter
                  side="in"
                  positions={positionsAvailable}
                  selected={wantPositions}
                  onToggle={(position) => {
                    const next = nextPositions(wantPositions, position);
                    setWantPositions(next);
                    announceToggle(position, next.includes(position), "get");
                  }}
                  onClear={() => {
                    setWantPositions([]);
                    setStatus("Cleared the positions you want. Press Search to apply.");
                  }}
                />
                <PositionFilter
                  side="out"
                  positions={positionsAvailable}
                  selected={givePositions}
                  onToggle={(position) => {
                    const next = nextPositions(givePositions, position);
                    setGivePositions(next);
                    announceToggle(position, next.includes(position), "give");
                  }}
                  onClear={() => {
                    setGivePositions([]);
                    setStatus(
                      "Cleared the positions you would send. Press Search to apply.",
                    );
                  }}
                />
              </div>
            )}

            {/* NAMED PLAYERS. More specific than a position, and the engine
                treats them that way: naming somebody stands the position ask on
                that side down rather than trying to satisfy both.

                Each row takes several. Everyone named on a side has to be in
                the deal on that side, so two names is one package and not two
                separate questions. */}
            {isLeague &&
              ((props.theirPlayers?.length ?? 0) > 0 ||
                (props.myPlayers?.length ?? 0) > 0) && (
                <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-2">
                  {(props.theirPlayers?.length ?? 0) > 0 && (
                    <PlayerPackagePicker
                      filterLabel="Find a player to get"
                      label="Players you want"
                      hint="What they would cost, together."
                      addLabel="Add a player you want"
                      chipsLabel="Players you want in the deal"
                      emptyNote="No players picked. Add one or more and every deal will bring all of them back."
                      options={props.theirPlayers ?? []}
                      selected={targetPlayerIds}
                      onChange={setTargetPlayerIds}
                      onAnnounce={setStatus}
                      max={MAX_NAMED_PLAYERS}
                    />
                  )}
                  {(props.myPlayers?.length ?? 0) > 0 && (
                    <PlayerPackagePicker
                      filterLabel="Find a player to send"
                      label="Players you would move"
                      hint="What they bring back as a package."
                      addLabel="Add a player you would move"
                      chipsLabel="Players you would send in the deal"
                      emptyNote="No players picked. Add one or more and every deal will send all of them."
                      options={props.myPlayers ?? []}
                      selected={offerPlayerIds}
                      onChange={setOfferPlayerIds}
                      onAnnounce={setStatus}
                      max={MAX_NAMED_PLAYERS}
                    />
                  )}
                </div>
              )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-base/30 px-4 py-3.5">
              {/* Says what it does. This used to read "Find another trade" and
                  re-ran a deterministic search with unchanged inputs, which
                  handed back the trade already on screen. The sentence that sat
                  beside it explained the arrows, which are their own labelled
                  controls twenty pixels lower. */}
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
                {hasSearched ? "Search" : "Find me a trade"}
              </button>
              {!isLeague && leaguesLeft !== null && leaguesLeft > 0 && (
                <p className="text-xs text-ink-muted">
                  {leaguesLeft} {leaguesLeft === 1 ? "league" : "leagues"} still to
                  search.
                </p>
              )}
            </div>
          </div>
        </section>
      </form>

      {/* Every result, move, pass, and save lands here. Polite so it waits for
          the reader to finish what they were reading rather than cutting in. */}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      {/* Two toggles over one region, drawn as a segmented strip so they read as
          a choice rather than as two loose buttons on the page background. Each
          carries its own count, which is the thing a reader actually wants from
          a tab label. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-card border border-line bg-surface/50 p-1.5">
        <TabButton
          active={tab === "suggestions"}
          Icon={Lightbulb}
          count={suggestions.length}
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
          <TabButton
            active={tab === "saved"}
            Icon={Bookmark}
            count={savedKeys.length}
            onClick={() => void openSaved()}
          >
            Saved
          </TabButton>
        ) : (
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-dashed border-line px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <Bookmark aria-hidden="true" className="h-4 w-4" />
            Sign in to save
          </Link>
        )}
      </div>

      {pending && (
        <p className="flex items-center gap-2 rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
          <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
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
              a sighted reader needs to know there are eleven more just as much.

              A bar rather than three loose controls: the counter sits between
              the two arrows that move it, in its own tray, so the relationship
              is the layout rather than something to work out. */}
          <div className="flex items-center gap-2 rounded-card border border-line bg-surface/50 px-2 py-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={!canGoBack}
              aria-label="Previous trade"
              className={NAV_BUTTON_CLASS}
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              <span aria-hidden="true" className="hidden sm:inline">
                Previous
              </span>
            </button>

            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-bold tabular-nums text-ink">
                Trade {at + 1}{" "}
                <span className="font-medium text-ink-muted">of {list.length}</span>
              </p>
              {/* What is behind the window, once, in three words rather than a
                  sentence hanging off the end of the row. */}
              {tab === "suggestions" && (meta?.beyondWindow ?? 0) > 0 && (
                <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-ink-subtle">
                  <Layers aria-hidden="true" className="h-3 w-3" />
                  {meta?.beyondWindow} more ranked behind
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => go(1)}
              disabled={!canGoForward}
              aria-label="Next trade"
              className={NAV_BUTTON_CLASS}
            >
              <span aria-hidden="true" className="hidden sm:inline">
                Next
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
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
              // The grade moves into the evaluation below whenever there is
              // going to be one, so the same verdict is never on screen twice.
              showGrade={!shownProposal}
              builderHref={builderHrefOf(
                shownSuggestion,
                leagueIdOf(shownSuggestion, currentSaved?.sleeperLeagueId),
              )}
            />
          </div>

          {currentSaved && (
            <p className="text-xs text-ink-muted">
              Saved {formatEastern(currentSaved.savedAtIso)}. Values are as they were
              then.
            </p>
          )}

          {/* What you can do with the deal, in its own tray under it. The labels
              are one or two words because the icon carries the rest; the
              accessible name spells out what a two-word label leaves implied, so
              a screen reader user pulling up the button list finds "Pass on this
              trade" rather than "Pass". */}
          <div className="flex flex-wrap gap-1.5 rounded-card border border-line bg-surface/50 p-1.5">
            <button
              type="button"
              onClick={() => void copyPitch()}
              aria-label="Copy the message to send the other manager"
              className={ACTION_BUTTON_CLASS}
            >
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-signal-success" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
              <span aria-hidden="true">{copied ? "Copied" : "Copy pitch"}</span>
            </button>

            {props.isSignedIn ? (
              <button
                type="button"
                onClick={() => void toggleSave()}
                disabled={savePending}
                aria-label={
                  tab === "saved"
                    ? "Remove this trade from your saved trades"
                    : isSaved
                      ? "Remove this trade from your saved trades"
                      : "Save this trade for later"
                }
                className={ACTION_BUTTON_CLASS}
              >
                {tab === "saved" ? (
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                ) : isSaved ? (
                  <BookmarkCheck aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                ) : (
                  <Bookmark aria-hidden="true" className="h-4 w-4" />
                )}
                <span aria-hidden="true">
                  {tab === "saved" ? "Remove" : isSaved ? "Saved" : "Save"}
                </span>
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center gap-2 rounded-card border border-dashed border-line px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Bookmark aria-hidden="true" className="h-4 w-4" />
                Sign in to save
              </Link>
            )}

            {tab === "suggestions" && (
              <button
                type="button"
                onClick={() => void decline()}
                aria-label="Pass on this trade"
                aria-describedby={passNoteId}
                className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-purple/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <ThumbsDown aria-hidden="true" className="h-4 w-4" />
                <span aria-hidden="true">Pass</span>
              </button>
            )}
          </div>

          {/* The note the Pass button is described by. aria-hidden would take it
              out of the tree the description resolves from, so it stays visible
              text and the button points at it rather than restating it. */}
          {tab === "suggestions" && (
            <p id={passNoteId} className="text-[11px] text-ink-subtle">
              Passing hides a trade for two weeks
              {props.isSignedIn ? "" : ", this visit only while signed out"}.
            </p>
          )}

          {/* THE FULL EVALUATION, the same one the builder renders.
              Below the actions rather than above them, and that order is
              deliberate. Copy, Save and Pass are about the DEAL and a reader
              flicking through twelve of them reaches for Pass on every card;
              putting three screens of evaluation between the card and that
              button would make the common move the buried one. The evaluation is
              the deep read, so it sits where a deep read belongs.

              Its own section with its own heading, so a screen reader user can
              jump to it or step over it in one move. Not keyed on the
              suggestion: the component caches every answer it has already paid
              for, and remounting would throw that away on each press of Next. */}
          {shownProposal && (
            <section aria-labelledby={evaluationId} className="pt-2">
              <h3 id={evaluationId} className="sr-only">
                What this trade does to your season
              </h3>
              <SuggestionEvaluation
                suggestionKey={shownSuggestion.key}
                sleeperLeagueId={shownProposal.leagueId}
                searchedUsername={props.searchedUsername ?? null}
                source={props.source ?? null}
                myRosterId={shownProposal.myRosterId}
                theirRosterId={shownProposal.theirRosterId}
                incoming={shownProposal.incoming}
                outgoing={shownProposal.outgoing}
                myTeamLabel={props.myTeamName ?? "Your team"}
                theirTeamLabel={shownSuggestion.counterparty.teamName}
                grade={shownGrade}
                positionalWarByPlayer={props.positionalWarByPlayer}
              />
            </section>
          )}
        </section>
      )}

      {!pending && !error && !shownSuggestion && tab === "saved" && saved !== null && (
        <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
          <p className="flex items-center gap-2 text-base font-semibold text-ink">
            <Bookmark aria-hidden="true" className="h-4 w-4 text-ink-subtle" />
            No saved trades yet.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            Press Save on a suggestion and it will be here, exactly as it was shown.
          </p>
        </div>
      )}

      {!pending && !error && !shownSuggestion && tab === "suggestions" && hasSearched && (
        <EmptyState
          mode={props.mode}
          meta={meta}
          strategy={strategy}
          leaguesLeft={leaguesLeft}
          declinedAll={sessionExcluded.length > 0}
          positionAsk={wantPositions.length + givePositions.length > 0}
          // A package is more than one name on ONE side. One player wanted and
          // one offered is an ordinary two-sided ask, and telling that reader
          // to "send them in separate deals" is advice about a question they
          // did not ask.
          packageAsk={targetPlayerIds.length > 1 || offerPlayerIds.length > 1}
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

// min-w-11 as well as min-h-11. Below sm the word beside the chevron is hidden
// and the button is a 16px icon in 24px of padding, which is a 40px target: the
// minimum has to be stated on both axes or the mobile state quietly misses it.
// The word is a label, not data; the icon plus the button's aria-label carry the
// same meaning at every width.
const NAV_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50";

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
  Icon,
  count,
  onClick,
  children,
}: {
  active: boolean;
  Icon: typeof Lightbulb;
  /** How many trades are behind this toggle. Zero renders no badge. */
  count: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // The count rides in the accessible name rather than being read as a
      // stray number after the label, which is what a bare "(3)" does.
      aria-label={count > 0 ? `${children}, ${count}` : children}
      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-card border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:flex-none ${
        active
          ? "border-brand-cyan/60 bg-brand-cyan/10 text-ink"
          : "border-transparent text-ink-muted hover:border-line hover:bg-surface hover:text-ink"
      }`}
    >
      <Icon
        aria-hidden="true"
        className={`h-4 w-4 shrink-0 ${active ? "text-brand-cyan" : "text-ink-subtle"}`}
      />
      <span aria-hidden="true">{children}</span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
            active ? "bg-brand-cyan/20 text-brand-cyan" : "bg-line-accent text-ink-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
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
  strategy,
  leaguesLeft,
  declinedAll,
  positionAsk,
  packageAsk,
}: {
  mode: "league" | "portfolio";
  meta: TradeFinderMeta | null;
  /**
   * What the ranking was chasing.
   *
   * Only read on the portfolio branch, and only to explain an empty answer. The
   * cross-league walk merges several leagues into one shortlist, so there is no
   * single engine notice it could carry; the reason still has to be said, or a
   * reader looking at forty other rosters concludes the search broke.
   */
  strategy: TradeStrategy;
  leaguesLeft: number | null;
  declinedAll: boolean;
  /**
   * Whether a position filter was part of the question.
   *
   * A fifth reason, and the newest one. Asking for a kicker back and a
   * quarterback out is a question a real league can answer with nothing, and a
   * reader who has just pressed four chips deserves to be pointed at them rather
   * than at a generic suggestion to ask for something else.
   */
  positionAsk: boolean;
  /**
   * Whether the reader pinned MORE THAN ONE player to the search.
   *
   * A package is a much narrower question than a single name, and a league can
   * quite honestly hold no level deal for two specific players moving
   * together while holding several for either of them alone. Pointing at the
   * chips is more use than a generic suggestion to ask for something else.
   */
  packageAsk: boolean;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
      <p className="flex items-center gap-2 text-base font-semibold text-ink">
        <SearchX aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />
        {declinedAll ? "That is everything we found." : "No trade to suggest."}
      </p>
      {mode === "league" ? (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {/* The engine's own reason first, when it has one. It fires for a
              question that could not have had an answer (players named across
              two rosters, a player we cannot price), and for the one case where
              the search DID run and refused everything it built: a contender
              search in a league where nothing on the board would add points to
              this lineup. In all of them every sentence below would be
              misleading, because the league is not short of deals. */}
          {meta?.notice
            ? // Both sentences when both apply. The engine's reason is the
              // accurate one and the position chips are the actionable one, and
              // suppressing the second sent a reader who had just pressed four
              // chips looking for a cause somewhere else. They can co-occur:
              // the position gate runs BEFORE the lineup floor, so a floored
              // deal did satisfy the chips.
              `${meta.notice}${positionAsk ? " The positions you picked narrow it further, so clearing one may open something up." : ""}`
            : declinedAll
              ? "Search again for a fresh set, or change what you are after."
              : meta && meta.consideredTeams === 0
                ? "No other team has a piece it would move yet."
                : packageAsk
                  ? "Nothing comes back level for those players as one package. Remove one of them, or send them in separate deals."
                  : positionAsk
                    ? "Nothing that fits those positions comes back level. Widen them, or clear one side."
                    : "Nothing we could build helps you or would be accepted. Name a player above to see what he would cost, or what he would bring back."}
        </p>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {leaguesLeft && leaguesLeft > 0
            ? "Nothing in those leagues. Search again for the rest."
            : strategy === "contender"
              ? // The floor applies here too, and the walk cannot carry a
                // per-league reason back, so the reason is stated from what we
                // do know: which question was asked. Without it this is the
                // exact "no trade to suggest" that the league page's own notice
                // exists to avoid.
                "Every league we can read has been searched, and nothing in them adds points to your starting lineup. Switch to Value to see the deals that win on what the pieces are worth."
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
