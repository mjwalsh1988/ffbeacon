"use client";

/**
 * The reader's own FAAB budget, for turning the board's percentages into
 * dollars.
 *
 * WHY THE BOARD SPEAKS IN PERCENTAGES AND THIS EXISTS AT ALL. A public page
 * cannot see anybody's league, and budgets differ by a factor of ten between
 * leagues we hold ($100 and $1,000 are both common). So every bid on the board
 * is a share of the season budget, which is right everywhere. This converter is
 * the one step a reader would otherwise do in their head: type the budget once
 * and every card adds the dollar range for that league beside the percentage.
 *
 * NOTHING IS REPLACED, ONLY ADDED. The percentage stays the headline figure on
 * every card, and the dollars appear as a second line. A reader who never
 * touches this sees the whole board exactly as it renders on the server.
 *
 * Remembered per browser in localStorage, wrapped in try/catch because private
 * windows and blocked storage throw, and the page must work without it. It is
 * a convenience, never state anybody else reads.
 */

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Wallet, X } from "lucide-react";

const STORAGE_KEY = "ffbeacon.waiver-budget";
const PRESETS = [100, 200, 1000];
const MAX_BUDGET = 100_000;
const INVALID_MESSAGE = "Enter a whole number of dollars from 1 to 100,000.";

type BudgetState = {
  budget: number | null;
  setBudget: (value: number | null) => void;
};

const BudgetContext = createContext<BudgetState>({ budget: null, setBudget: () => {} });

function readStored(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 && n <= MAX_BUDGET ? Math.round(n) : null;
  } catch {
    return null;
  }
}

function writeStored(value: number | null): void {
  try {
    if (value == null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage blocked: the converter still works for this visit.
  }
}

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [budget, setBudgetState] = useState<number | null>(null);

  useEffect(() => {
    setBudgetState(readStored());
  }, []);

  const setBudget = useCallback((value: number | null) => {
    setBudgetState(value);
    writeStored(value);
  }, []);

  return <BudgetContext.Provider value={{ budget, setBudget }}>{children}</BudgetContext.Provider>;
}

function dollars(pct: number, budget: number): number {
  return Math.round((pct / 100) * budget);
}

/**
 * The dollar line under a bid. Renders nothing until a budget is set, so the
 * server render and the first client render agree.
 */
export function BidInDollars({
  lowPct,
  highPct,
  className = "",
}: {
  lowPct: number;
  highPct: number;
  className?: string;
}) {
  const { budget } = useContext(BudgetContext);
  if (budget == null) return null;
  const low = dollars(lowPct, budget);
  const high = dollars(highPct, budget);
  return (
    <span className={className}>
      {low === high ? `$${high}` : `$${low} to $${high}`}
      <span className="text-ink-subtle"> of your ${budget}</span>
    </span>
  );
}

/**
 * The control. A labelled number field plus three one-tap presets, and a live
 * region that says what changed, because the effect lands on cards the reader
 * may not be looking at.
 */
export function BudgetConverter() {
  const { budget, setBudget } = useContext(BudgetContext);
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    setDraft(budget == null ? "" : String(budget));
  }, [budget]);

  function apply(value: number | null) {
    setInvalid(false);
    setBudget(value);
    setAnnouncement(
      value == null
        ? "Dollar amounts cleared. Bids show as a percentage of budget only."
        : `Every bid now also shows in dollars for a $${value} budget.`,
    );
  }

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (budget != null) apply(null);
      return;
    }
    const n = Math.round(Number(trimmed));
    if (Number.isFinite(n) && n > 0 && n <= MAX_BUDGET) {
      if (n !== budget) apply(n);
    } else {
      // Kept in the field, flagged and said out loud, so a reader who typed
      // 0 or a letter knows why nothing changed instead of watching it vanish.
      setInvalid(true);
      setAnnouncement(INVALID_MESSAGE);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${inputId}-heading`}
      className="rounded-2xl border border-line bg-base/50 p-3 [container-type:inline-size] sm:p-3.5"
    >
      {/* Side by side only when the converter itself has the room, which
          depends on the column it sits in rather than on the screen. */}
      <div className="flex flex-col gap-3 [@container(min-width:50rem)]:flex-row [@container(min-width:50rem)]:items-center [@container(min-width:50rem)]:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan"
          >
            <Wallet className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p id={`${inputId}-heading`} className="text-sm font-semibold text-ink">
              See bids in your league&apos;s dollars
            </p>
            <p id={hintId} className="mt-0.5 text-xs leading-relaxed text-ink-muted">
              Budgets differ from league to league, so bids are percentages. Enter yours to add
              dollars to every card.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <label htmlFor={inputId} className="sr-only">
              Season FAAB budget, in dollars
            </label>
            <div
              className={`flex items-center rounded-xl border bg-surface focus-within:ring-2 focus-within:ring-brand-cyan ${
                invalid ? "border-signal-danger" : "border-line focus-within:border-brand-cyan/70"
              }`}
            >
              <span aria-hidden="true" className="pl-3 font-mono text-sm text-ink-subtle">
                $
              </span>
              <input
                id={inputId}
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_BUDGET}
                step={1}
                value={draft}
                placeholder="Budget"
                aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (invalid) setInvalid(false);
                }}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
                }}
                className="min-h-11 w-full min-w-0 bg-transparent px-2 font-mono text-base tabular-nums text-ink placeholder:font-sans placeholder:text-sm placeholder:text-ink-subtle focus:outline-none sm:w-28"
              />
            </div>
          </div>

          <div role="group" aria-label="Common budgets" className="grid grid-cols-4 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={budget === preset}
                // A toggle: pressing the active budget again turns dollars off.
                onClick={() => apply(budget === preset ? null : preset)}
                className={`min-h-11 rounded-xl border px-2.5 font-mono text-sm font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  budget === preset
                    ? "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
                    : "border-line bg-surface text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
              >
                <span className="sr-only">Use a </span>${preset.toLocaleString("en-US")}
                <span className="sr-only"> budget</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (budget == null) return;
                apply(null);
                // The button goes inert once there is nothing to clear, so
                // focus moves to the field rather than dropping to the page.
                inputRef.current?.focus();
              }}
              aria-disabled={budget == null}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-surface px-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              Clear
              <span className="sr-only"> the dollar amounts</span>
            </button>
          </div>
        </div>
      </div>

      {invalid && (
        <p id={errorId} className="mt-2 text-xs text-signal-danger">
          {INVALID_MESSAGE}
        </p>
      )}
      {budget != null && !invalid && (
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
          In a ${budget.toLocaleString("en-US")} league, 10% is ${dollars(10, budget)} and 25% is ${dollars(25, budget)}.
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
