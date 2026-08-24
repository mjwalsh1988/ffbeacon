"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { EvaluationState } from "@/components/trade-ideas/evaluation-states";
import { SignalCheckNote } from "@/components/trade-ideas/signal-check-note";
import { TradeVerdict } from "@/components/trade-ideas/trade-verdict";
import { evaluateProposedTrade } from "@/app/actions/trade-impact";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { BuildAsset, TradeImpact } from "@/lib/trade-impact/types";

/**
 * The full evaluation of the suggestion currently on screen.
 *
 * WHY THE SUGGESTION TAB GETS THE BUILDER'S ANSWER
 *   A suggestion card says what the deal IS and roughly what it does. The
 *   builder's evaluation says what it does to your season: projected wins and
 *   playoff odds before and after, the effect on each remaining week against the
 *   real schedule, the reasons behind the call, and what the other manager gets
 *   out of it. Those are the same figures either way, and a reader who was handed
 *   a trade needs them at least as much as one who typed a trade in. Sending them
 *   to a different tab to find out was the tax.
 *
 * WHY IT IS A FETCH HERE AND A SERVER RENDER THERE
 *   Build mode reads its trade out of the URL, so the server can evaluate it
 *   during render. This surface holds twelve suggestions in client state and
 *   moves between them with no navigation at all, so there is no render for the
 *   server to do the work in. Same action, same three gates, same one rate-limit
 *   bucket (lib/trade-impact/rate-limit.ts): this is the third path that file
 *   already names.
 *
 * WHY IT IS DEBOUNCED AND CACHED
 *   An evaluation is two Monte Carlo seasons plus forty to eighty exact lineup
 *   fills, and the limit is ten a minute. Firing one per card would spend a
 *   reader's whole minute on the first six presses of Next, most of them on
 *   cards they were skipping past. So a card has to sit still for
 *   SETTLE_MS before its evaluation starts, and every answer is kept for the
 *   visit: flicking through costs one evaluation rather than twelve, and going
 *   back to a deal you have already seen costs nothing at all.
 *
 * WHY IT DOES NOT RETRY ITSELF
 *   The one failure a reader will actually meet is the rate limit, and a limit
 *   that retries on its own is a limit that hammers. The retry is a button.
 */

/**
 * How long a suggestion has to be the one on screen before it is evaluated.
 *
 * Long enough that holding Next does not queue an evaluation per card, short
 * enough that a reader who stops to read one does not notice a wait before the
 * "working" panel appears.
 */
const SETTLE_MS = 700;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; impact: TradeImpact }
  | { kind: "rate-limited" }
  | { kind: "error"; message: string };

export function SuggestionEvaluation({
  suggestionKey,
  sleeperLeagueId,
  searchedUsername,
  source,
  myRosterId,
  theirRosterId,
  incoming,
  outgoing,
  myTeamLabel,
  theirTeamLabel,
  grade,
}: {
  /** The deal's fingerprint. Identity for the cache and the settle timer. */
  suggestionKey: string;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  source: string | null;
  myRosterId: number;
  theirRosterId: number;
  incoming: BuildAsset[];
  outgoing: BuildAsset[];
  myTeamLabel: string;
  theirTeamLabel: string;
  /**
   * Signal Check's verdict on this deal.
   *
   * Rendered here only while the evaluation is NOT showing. On success the
   * Value tab inside the verdict carries it, and the card above has already
   * dropped its own copy, so the grade is on screen exactly once in every state.
   */
  grade: SuggestionGrade | null;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  /**
   * Answers already paid for, by suggestion key, for this visit.
   *
   * A ref rather than state: writing to it must not re-render, and it has to
   * survive every suggestion change, which is why this component is never keyed
   * on the suggestion. Bounded by the shortlist, which the server caps.
   */
  const cache = useRef<Map<string, TradeImpact>>(new Map());

  /**
   * Which key the newest request belongs to.
   *
   * Two evaluations can be in flight when a reader moves on mid-request, and the
   * slower one can land last. Without this the reader would be shown the
   * evaluation of a trade they had already navigated away from, under the card
   * for a different deal, with nothing on screen saying so.
   */
  const latest = useRef(suggestionKey);

  /**
   * The proposal to send, read at call time rather than closed over.
   *
   * `incoming` and `outgoing` are freshly mapped arrays on every render of the
   * parent, so a `run` that listed them as dependencies would be a new function
   * on every render, the effect below would re-run on every render, and its
   * setState would render again: a loop that never settles and never stops
   * evaluating. Keying the effect on the suggestion's fingerprint alone is the
   * fix, and that requires the request to come from somewhere stable.
   */
  const current = useRef({
    suggestionKey,
    sleeperLeagueId,
    myRosterId,
    theirRosterId,
    incoming,
    outgoing,
    searchedUsername,
    source,
  });
  current.current = {
    suggestionKey,
    sleeperLeagueId,
    myRosterId,
    theirRosterId,
    incoming,
    outgoing,
    searchedUsername,
    source,
  };

  const run = useCallback(async () => {
    const now = current.current;
    const key = now.suggestionKey;
    latest.current = key;
    setState({ kind: "loading" });

    const res = await evaluateProposedTrade({
      sleeperLeagueId: now.sleeperLeagueId,
      myRosterId: now.myRosterId,
      theirRosterId: now.theirRosterId,
      incoming: now.incoming,
      outgoing: now.outgoing,
      username: now.searchedUsername,
      source: now.source,
    }).catch(() => null);

    if (latest.current !== key) return;

    if (res === null) {
      setState({ kind: "error", message: "Something went wrong. Try again." });
      return;
    }
    if (!res.ok) {
      setState(
        res.retryable ? { kind: "rate-limited" } : { kind: "error", message: res.error },
      );
      return;
    }
    cache.current.set(key, res.impact);
    setState({ kind: "ready", impact: res.impact });
  }, []);

  useEffect(() => {
    // Claimed HERE, the moment the card changes, and not only when a request
    // starts. A request that starts is 700ms behind the card that asked for it,
    // and in that gap the previous card's request can still land: with the claim
    // made only inside `run`, the guard would still be holding the OLD key, the
    // stale response would pass it, and a full evaluation of the trade the
    // reader just moved past would render under the one they moved to.
    latest.current = suggestionKey;

    const cached = cache.current.get(suggestionKey);
    if (cached) {
      setState({ kind: "ready", impact: cached });
      return;
    }

    // Idle, not loading, until the timer fires. A "working" panel that appears
    // under every card a reader flicks past is the same noise the debounce
    // exists to prevent, one layer up.
    setState({ kind: "idle" });
    const timer = setTimeout(() => void run(), SETTLE_MS);
    return () => clearTimeout(timer);
    // The fingerprint alone. `run` is stable, and everything else it needs is
    // read from the ref above at call time; see the note there for why listing
    // the asset arrays here would not terminate.
  }, [run, suggestionKey]);

  if (state.kind === "ready") {
    return (
      <TradeVerdict
        impact={state.impact}
        myTeamLabel={myTeamLabel}
        theirTeamLabel={theirTeamLabel}
      />
    );
  }

  return (
    <div className="space-y-4">
      {state.kind === "rate-limited" ? (
        <EvaluationState
          kind="rate-limited"
          message="You have run a lot of evaluations in the last minute. The deal above is unchanged; press below to work it out again."
        />
      ) : state.kind === "error" ? (
        <EvaluationState kind="error" message={state.message} />
      ) : (
        // Idle and loading render the same panel on purpose. The settle timer is
        // under a second, and flashing an empty placeholder before a "working"
        // one would be two layout changes to say one thing.
        <EvaluationState kind="loading" />
      )}

      {(state.kind === "rate-limited" || state.kind === "error") && (
        <>
          <button
            type="button"
            onClick={() => void run()}
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Work it out again
          </button>
          {/* Signal Check still has an opinion even when the season model could
              not run, and it is the one figure the card above gave up on the
              understanding that this section would carry it. */}
          {grade && <SignalCheckNote grade={grade} />}
        </>
      )}
    </div>
  );
}
