"use client";

import { useId, useState } from "react";
import { CircleCheck, CircleSlash, Search } from "lucide-react";
import { AvailabilityMeter } from "@/components/free-agent-finder-panel";

/**
 * A working sample of the Free Agent Finder for a reader who cannot run the
 * real one yet (signed out, or no Sleeper username saved).
 *
 * Everything here is invented and fenced as such, by words rather than styling:
 * the players are described by role ("A backup running back"), never named, the
 * leagues are "Example league A" to "F", a Sample badge leads the card, and the
 * heading says these are not anybody's leagues. The answer card is the real
 * `AvailabilityMeter`, so the sample draws exactly what a real search draws.
 *
 * The player picker is a radio group of native radios, so arrow keys, checked
 * state and the group name come from the platform. The one-line answer sits in
 * a polite live region; the six rows do not, so changing the player announces
 * the answer and nothing else, the same rule the real finder follows.
 */

type SampleStatus =
  "free" | "starting" | "bench" | "reserve" | "taxi" | "unknown";

type SamplePlayer = {
  id: string;
  label: string;
  hint: string;
  /** One status per example league, in league order. */
  statuses: SampleStatus[];
};

const LEAGUES = [
  "Example league A",
  "Example league B",
  "Example league C",
  "Example league D",
  "Example league E",
  "Example league F",
];

const PLAYERS: SamplePlayer[] = [
  {
    id: "rb",
    label: "A backup running back",
    hint: "The starter just got hurt",
    statuses: ["free", "free", "bench", "free", "taxi", "unknown"],
  },
  {
    id: "wr",
    label: "A rookie wide receiver",
    hint: "Two big games in a row",
    statuses: ["bench", "free", "starting", "reserve", "free", "unknown"],
  },
  {
    id: "te",
    label: "A breakout tight end",
    hint: "New role in the offense",
    statuses: ["starting", "bench", "starting", "bench", "starting", "unknown"],
  },
  {
    id: "qb",
    label: "A streaming quarterback",
    hint: "Soft matchup this week",
    statuses: ["free", "free", "free", "free", "bench", "unknown"],
  },
];

const STATUS_DETAIL: Record<SampleStatus, string> = {
  free: "Free agent",
  starting: "Rostered, starting for another team",
  bench: "Rostered, on another team's bench",
  reserve: "Rostered, on injured reserve",
  taxi: "Rostered, on a taxi squad",
  unknown: "Not answered, this league is not synced yet",
};

export function FreeAgentFinderDemo() {
  const groupName = useId();
  const [selectedId, setSelectedId] = useState(PLAYERS[0].id);
  const player = PLAYERS.find((p) => p.id === selectedId) ?? PLAYERS[0];

  // Free first, then rostered, then unanswered, the order the real list uses.
  const rows = LEAGUES.map((league, i) => ({
    league,
    status: player.statuses[i],
  })).sort((a, b) => rank(a.status) - rank(b.status));

  const answered = rows.filter((r) => r.status !== "unknown");
  const freeCount = answered.filter((r) => r.status === "free").length;
  const unansweredCount = rows.length - answered.length;
  const name = player.label.replace(/^A /, "The ");

  return (
    <div className="rounded-modal border border-dashed border-brand-purple/50 bg-surface/40 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-brand-purple/50 bg-brand-purple/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-purple">
          Sample
        </span>
        <h3 id="faf-demo-heading" className="text-sm font-semibold text-ink">
          Try it with six invented leagues, not yours
        </h3>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink-muted">
          Pick a player to check
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PLAYERS.map((p) => {
            const checked = p.id === selectedId;
            return (
              <label
                key={p.id}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-card border px-3 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan ${
                  checked
                    ? "border-brand-purple bg-brand-purple/15"
                    : "border-line bg-base/50 hover:border-line-accent"
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={p.id}
                  checked={checked}
                  onChange={() => setSelectedId(p.id)}
                  aria-describedby={`${groupName}-${p.id}-hint`}
                  className="h-4 w-4 shrink-0 accent-brand-purple"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {p.label}
                  </span>
                  <span
                    id={`${groupName}-${p.id}-hint`}
                    className="block text-xs text-ink-subtle"
                  >
                    {p.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div role="status" aria-live="polite" className="mt-5">
        <AvailabilityMeter
          playerName={name}
          freeCount={freeCount}
          rosteredCount={answered.length - freeCount}
          total={answered.length}
        />
      </div>
      {unansweredCount > 0 && (
        <p className="mt-2 text-xs text-ink-subtle">
          {unansweredCount} more{" "}
          {unansweredCount === 1 ? "league was" : "leagues were"} not searched,
          because no rosters are stored for{" "}
          {unansweredCount === 1 ? "it" : "them"} yet.
        </p>
      )}

      <ul
        role="list"
        aria-label={`Sample result: the six example leagues, and whether ${name.toLowerCase()} is a free agent in each. Free agents first.`}
        className="mt-3 grid gap-2 sm:grid-cols-2"
      >
        {rows.map((row) => (
          <SampleRow key={row.league} league={row.league} status={row.status} />
        ))}
      </ul>
    </div>
  );
}

function rank(status: SampleStatus): number {
  if (status === "free") return 0;
  if (status === "unknown") return 2;
  return 1;
}

function SampleRow({
  league,
  status,
}: {
  league: string;
  status: SampleStatus;
}) {
  const free = status === "free";
  const unknown = status === "unknown";
  return (
    <li
      className={`flex items-center gap-3 rounded-card border px-3 py-2.5 ${
        free
          ? "border-signal-success/45 bg-signal-success/10"
          : unknown
            ? "border-dashed border-line bg-transparent"
            : "border-line bg-base/40"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
          free
            ? "border-signal-success/50 bg-signal-success/15 text-signal-success"
            : unknown
              ? "border-dashed border-line-accent bg-transparent text-ink-subtle"
              : "border-line-accent bg-surface text-ink-subtle"
        }`}
      >
        {free ? (
          <CircleCheck className="h-4 w-4" />
        ) : unknown ? (
          <Search className="h-4 w-4" />
        ) : (
          <CircleSlash className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {league}
        </span>
        <span
          className={`mt-0.5 block text-[11px] ${
            free ? "font-semibold text-signal-success" : "text-ink-subtle"
          }`}
        >
          {STATUS_DETAIL[status]}
        </span>
      </span>
    </li>
  );
}
