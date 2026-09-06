"use client";

import { useId } from "react";
import { LeagueLogo } from "@/components/league-logo";

/**
 * One league, as a choice in a list.
 *
 * `meta` is the line the native `<select>` used to carry in parentheses:
 * "12 teams, 2026", "3 FAAB left", "syncs when picked". It lives inside the
 * label so it is announced with the choice rather than after it.
 */
export type LeagueChoice = {
  sleeperLeagueId: string;
  name: string;
  avatar: string | null;
  meta?: string | null;
  /** A choice that cannot be picked, with the reason inside its label. */
  disabledReason?: string | null;
  /** A row doing async work right now, said out loud. */
  busyLabel?: string | null;
};

/**
 * The text a screen reader hears for one row, as the DOM below produces it.
 *
 * NOT applied as an `aria-label`, deliberately. The name a radio gets from its
 * wrapping label is computed from that label's content, which is the same
 * words in the same order (the logo is `aria-hidden`, so it contributes
 * nothing). An `aria-label` would only add period separators, and it would
 * take on the job of staying in step with the markup: add a visible badge to a
 * row tomorrow and name-from-content picks it up while an author-supplied name
 * silently swallows it. `<label>` also maps to role `generic`, where ARIA 1.2
 * prohibits an author name, so it would be a spec-ambiguous path used to say
 * what the well-defined one already says.
 *
 * So this exists to DESCRIBE the announced string in a test, and the test is
 * honest about being a description rather than the source of truth.
 *
 * The order is name, then meta, then the two states, because the name is what
 * a reader is scanning for and the rest qualifies it.
 */
export function describeChoice(choice: LeagueChoice): string {
  const parts = [choice.name];
  if (choice.meta) parts.push(choice.meta);
  if (choice.busyLabel) parts.push(choice.busyLabel);
  if (choice.disabledReason) parts.push(choice.disabledReason);
  return parts.join(". ");
}

/**
 * A list of leagues to pick one of.
 *
 * This replaces two native `<select>` elements, and the reason is narrow: a
 * `<select>` cannot show an image, and every list of leagues on the site now
 * shows the league's own logo. Nothing else about the control changes.
 *
 * Native radios rather than `role="radio"` on divs. Arrow-key movement,
 * checked state and form participation all come for free from the platform,
 * so the keyboard behaviour is not worse than the select it replaces. Rolling
 * our own would mean reimplementing all three and getting one of them wrong.
 *
 * ABSOLUTE RULE FOR CALLERS: `onChange` MUST NOT trigger expensive or
 * rate-limited work. In a native radiogroup arrow keys move SELECTION, not
 * just focus, so a reader pressing Down four times to reach the fifth league
 * fires `onChange` four times. Wiring a Sleeper sync or a rate-limited action
 * to it means a keyboard reader can lock themselves out of the tool while a
 * mouse user never sees it, and the `<select>` this replaces did not have that
 * problem because a platform picker commits on Enter. Selection sets state; a
 * separate button is the action. All three callers do it that way.
 */
export function LeagueChoiceList({
  label,
  choices,
  value,
  onChange,
  logoSize = 40,
  className = "",
}: {
  /** Accessible name of the group. "Your leagues". */
  label: string;
  choices: LeagueChoice[];
  /** The selected sleeperLeagueId, or "" for none. */
  value: string;
  onChange: (sleeperLeagueId: string) => void;
  logoSize?: 32 | 40 | 48;
  className?: string;
}) {
  const groupName = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-2 ${className}`}
    >
      {choices.map((choice) => {
        const disabled = Boolean(choice.disabledReason);
        const selected = value === choice.sleeperLeagueId;
        return (
          <label
            key={choice.sleeperLeagueId}
            className={[
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-card border p-3 transition-colors",
              selected
                ? "border-brand-purple bg-brand-purple/10"
                : "border-line bg-surface hover:border-line-accent",
              disabled ? "cursor-not-allowed opacity-60" : "",
              "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan",
            ].join(" ")}
          >
            <input
              type="radio"
              name={groupName}
              value={choice.sleeperLeagueId}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(choice.sleeperLeagueId)}
              // Visually hidden, not display:none. A hidden radio is not
              // focusable and the whole group would drop out of the tab order.
              className="sr-only"
            />
            <LeagueLogo
              avatarId={choice.avatar}
              name={choice.name}
              size={logoSize}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {choice.name}
              </span>
              {choice.meta && (
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {choice.meta}
                </span>
              )}
              {choice.busyLabel && (
                <span className="mt-0.5 block text-xs text-brand-cyan">
                  {choice.busyLabel}
                </span>
              )}
              {choice.disabledReason && (
                <span className="mt-0.5 block text-xs text-ink-subtle">
                  {choice.disabledReason}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
