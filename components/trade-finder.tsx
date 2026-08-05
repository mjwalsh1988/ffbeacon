"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw, ThumbsDown, Copy, Check } from "lucide-react";
import { TradeFinderCard } from "@/components/trade-finder-card";
import {
  declineSuggestion,
  findLeagueTrade,
  findPortfolioTrade,
  type TradeFinderMeta,
} from "@/app/actions/trade-finder";
import { TRADE_GOALS, type TradeGoal, type TradeSuggestion } from "@/lib/trade-finder/types";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { CrossLeagueSuggestion } from "@/lib/trade-finder-cross-league";

/**
 * Trade Finder, one deal at a time.
 *
 * WHY ONE
 *   A list of twenty trades is a spreadsheet, and a spreadsheet is what a
 *   manager opens instead of making a decision. One deal, with the arithmetic
 *   already done and a pass button underneath it, is a decision. The engine
 *   still ranks the whole field; the reader just never has to.
 *
 *   The pass is the only steering this feature has, so it is treated as real
 *   input rather than as a dismiss: it goes to the database for a signed-in
 *   reader and holds for two weeks. Signed out, it is held here for the visit,
 *   and the copy says so rather than quietly forgetting.
 *
 * ONE COMPONENT, TWO SURFACES
 *   `league` mode searches the eleven other teams in one room. `portfolio` mode
 *   walks every league the reader is in, a few at a time, and the card carries
 *   the league name because it is no longer implied by the page. Everything
 *   else, the controls, the pass, the announcements, the empty states, is
 *   identical, which is the point: there is one Trade Finder and it is the same
 *   feature wherever it is opened.
 *
 * ANNOUNCEMENTS
 *   A new suggestion arriving is a page change a sighted reader sees and a
 *   screen reader user would otherwise miss. So each result is announced in a
 *   live region AND focus moves to the new card's heading, which is what makes
 *   "Not interested" usable without a mouse: press it, and the next deal is
 *   where the cursor already is.
 */

export type PlayerOption = {
  playerId: string;
  label: string;
  /** The team that holds him, for the acquire picker's option groups. */
  group: string;
};

type Loaded = {
  suggestion: (TradeSuggestion | CrossLeagueSuggestion) | null;
  grade: SuggestionGrade | null;
};

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
  initial?: { suggestion: TradeSuggestion | null; grade: SuggestionGrade | null; meta: TradeFinderMeta };
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

  const [loaded, setLoaded] = useState<Loaded>({
    suggestion: props.initial?.suggestion ?? null,
    grade: props.initial?.grade ?? null,
  });
  const [meta, setMeta] = useState<TradeFinderMeta | null>(props.initial?.meta ?? null);
  const [cursor, setCursor] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(
    props.initial?.meta.remaining ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  /** Passes held for this visit. The only pass list a guest gets. */
  const [sessionExcluded, setSessionExcluded] = useState<string[]>([]);
  /** True once the reader has asked for something, so empty reads as an answer. */
  const [hasSearched, setHasSearched] = useState(Boolean(props.initial));

  const headingId = useId();
  const cardRef = useRef<HTMLElement>(null);
  /** Set when the next render should move focus onto the new card. */
  const focusNext = useRef(false);

  useEffect(() => {
    if (!focusNext.current || pending) return;
    focusNext.current = false;
    const heading = cardRef.current?.querySelector<HTMLElement>("[data-card-focus]");
    heading?.focus();
  }, [loaded, pending]);

  const search = useCallback(
    async (excluded: string[], nextCursor: number, moveFocus: boolean) => {
      setPending(true);
      setError(null);
      setCopied(false);
      setHasSearched(true);
      focusNext.current = moveFocus;
      // Said at the START of the search, not only at the end. Two or three
      // seconds of silence after pressing a button is indistinguishable from a
      // button that did nothing.
      setStatus("Searching for a trade.");

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
            setLoaded({ suggestion: null, grade: null });
            setStatus(res.error);
            return;
          }
          setLoaded({ suggestion: res.suggestion, grade: res.grade });
          setMeta(res.meta);
          setRemaining(res.meta.remaining);
          // Short on purpose. Focus moves to the card a moment later and the
          // heading there IS the deal, so spelling the trade out here would have
          // a screen reader read the whole thing twice.
          setStatus(
            res.suggestion
              ? `Found a trade with ${res.suggestion.counterparty.teamName}. ${res.meta.remaining} more ${res.meta.remaining === 1 ? "suggestion" : "suggestions"} behind it.`
              : "No trade to suggest with these settings.",
          );
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
            setLoaded({ suggestion: null, grade: null });
            setStatus(res.error);
            return;
          }
          setLoaded({ suggestion: res.suggestion, grade: res.grade });
          setCursor(res.cursor);
          setRemaining(res.remaining);
          setStatus(
            res.suggestion
              ? `Found a trade in ${res.suggestion.league.name}, with ${res.suggestion.counterparty.teamName}. ${res.remaining} ${res.remaining === 1 ? "league" : "leagues"} not searched yet.`
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

  /**
   * Pass on this deal and show the next.
   *
   * The key goes into the local list whether or not the write lands, so a failed
   * or signed-out write still advances rather than handing back the same trade
   * and looking broken.
   */
  const decline = useCallback(async () => {
    const current = loaded.suggestion;
    if (!current) return;
    const leagueId =
      "league" in current ? current.league.sleeperLeagueId : (props.sleeperLeagueId ?? "");

    const next = [...sessionExcluded, current.key];
    setSessionExcluded(next);
    setStatus("Passed. Finding the next one.");

    if (props.isSignedIn && leagueId) {
      await declineSuggestion({ sleeperLeagueId: leagueId, suggestionKey: current.key });
    }
    await search(next, cursor, true);
  }, [cursor, loaded.suggestion, props.isSignedIn, props.sleeperLeagueId, search, sessionExcluded]);

  /**
   * Copy the message, not the card.
   *
   * The engine writes `pitch` for the OTHER manager: it opens as a question and
   * says only what the deal does for them. It deliberately omits everything on
   * the card about what the reader gains, because the person receiving it does
   * not care and telling them hands over the reason to say no.
   */
  const copyPitch = useCallback(async () => {
    const current = loaded.suggestion;
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.pitch);
      setCopied(true);
      setStatus("Pitch copied. Paste it into your league chat.");
    } catch {
      setStatus(
        "Your browser blocked the copy. Open the message preview on the card and select it instead.",
      );
    }
  }, [loaded.suggestion]);

  const suggestion = loaded.suggestion;
  const leagueIdForCard =
    suggestion && "league" in suggestion
      ? suggestion.league.sleeperLeagueId
      : (props.sleeperLeagueId ?? "");

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(sessionExcluded, isLeague ? 0 : 0, true);
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
                  onChange={(e) => setGoal(e.target.value as TradeGoal)}
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
              <Field
                label="Player you would move"
                hint="Shows what he brings back."
              >
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
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2 text-sm font-bold text-black shadow-[0_0_24px_-10px_rgba(168,85,247,0.9)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
              )}
              {hasSearched ? "Find another trade" : "Find me a trade"}
            </button>
            {remaining !== null && !pending && (
              <p className="text-xs text-ink-muted">
                {isLeague
                  ? `${remaining} more ${remaining === 1 ? "suggestion" : "suggestions"} behind this one`
                  : remaining > 0
                    ? `${remaining} more ${remaining === 1 ? "league" : "leagues"} to search`
                    : "Every league searched"}
              </p>
            )}
          </div>
        </fieldset>
      </form>

      {/* Every result, error, and pass lands here. Polite so it waits for the
          reader to finish what they were reading rather than cutting in. */}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>

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

      {!pending && !error && suggestion && (
        // A named region, labelled by the card's own headline, so the deal is
        // one thing a screen reader can jump to and step out of rather than a
        // run of paragraphs between two buttons.
        <section
          ref={cardRef}
          aria-labelledby={headingId}
          className="space-y-3"
        >
          {/* tabIndex -1 makes this a focus target without putting it in the tab
              order; focus lands here after every pass. It keeps a visible ring
              rather than outline-none, because a sighted keyboard user needs to
              see where focus went just as much as anyone else. */}
          <div
            data-card-focus
            tabIndex={-1}
            className="rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <TradeFinderCard
              suggestion={suggestion}
              grade={loaded.grade}
              sleeperLeagueId={leagueIdForCard}
              searchedUsername={props.searchedUsername ?? null}
              headingId={headingId}
              leagueLabel={"league" in suggestion ? suggestion.league.name : null}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyPitch()}
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-signal-success" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy the pitch"}
            </button>
            <button
              type="button"
              onClick={() => void decline()}
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-purple/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <ThumbsDown aria-hidden="true" className="h-4 w-4" />
              Not interested, show me another
            </button>
          </div>

          <p className="text-xs text-ink-muted">
            {props.isSignedIn
              ? "Passes last two weeks."
              : "Passes last this visit. Sign in to keep them for two weeks."}
          </p>
        </section>
      )}

      {!pending && !error && !suggestion && hasSearched && (
        <EmptyState mode={props.mode} meta={meta} remaining={remaining} />
      )}
    </div>
  );
}

const SELECT_CLASS =
  "min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

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
 * Nothing to suggest.
 *
 * Says WHY, because "no results" on a feature like this reads as a broken
 * feature. The three real reasons are a league nobody has synced, a portfolio
 * we have already walked to the end of, and a genuine answer of no: every trade
 * the engine could build either helps nobody or would be laughed at.
 */
function EmptyState({
  mode,
  meta,
  remaining,
}: {
  mode: "league" | "portfolio";
  meta: TradeFinderMeta | null;
  remaining: number | null;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
      <p className="text-base font-semibold text-ink">No trade to suggest right now.</p>
      {mode === "league" ? (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {meta && meta.consideredTeams === 0
            ? "No other team has a piece it would move yet."
            : "Everything we could build either does nothing for you or would be refused. Try a different goal, or name a player you want."}
        </p>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {remaining && remaining > 0
            ? "Nothing in those leagues. Press again for the rest."
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
