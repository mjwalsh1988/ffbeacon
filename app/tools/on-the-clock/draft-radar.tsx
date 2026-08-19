"use client";

/**
 * The draft radar: what changed, and what you are about to lose.
 *
 * Three panels that a drafter with the board in front of them reads off it, and
 * that a drafter using a screen reader cannot:
 *
 *   Alerts        positional runs and tier cliffs, announced as they happen.
 *   Your turn     picks until you are up, and how long that is in picks.
 *   Gone by then  who the market takes before you are back on the clock.
 *
 * The alerts live region is `polite`, never `assertive`. A run on running backs
 * is worth knowing and is never worth interrupting someone mid-sentence, and an
 * assertive region during a fast draft would talk over everything else the page
 * has to say. Only alerts that are NEW since the last render are announced; the
 * panel itself always shows the full current set.
 *
 * THE ANNOUNCER IS NOT IN THIS FILE. It lives in the room shell
 * (DraftAlertAnnouncer, below, mounted by on-the-clock-client.tsx), because this
 * panel unmounts on the Rosters tab and on the full-width board view: the two
 * places a drafter is most likely parked. Its live region went with it, so a run
 * that started while someone was looking at the board was never spoken, and
 * coming back re-inserted a region with content already in it, which browsers
 * generally do not announce. Missed alerts, then silence. The panel keeps the
 * visible list; the speaking is done somewhere that never leaves the DOM.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, Layers, Radar } from "lucide-react";
import type { DraftAlert, GoneBeforeEntry } from "@/lib/on-the-clock/draft-alerts";
import { PlayerHeadshot } from "@/components/player-headshot";
import { Panel } from "./panel";

/**
 * The room's one alert announcer. Mounted in the room shell, outside the views,
 * so it survives every view change and the `seen` set survives with it.
 *
 * "Your turn" is deliberately NOT spoken here. The command bar already announces
 * it assertively the moment it becomes true, and an assertive interruption
 * followed by a polite repeat of the same sentence is worse than either alone.
 * The turn alert still appears in the visible radar panel.
 *
 * The clear-then-set is not a flourish. Alert ids fold in the pick number
 * specifically so a run that EXTENDS and a tier cliff that gets CLOSER announce
 * again, and both of those produce a new id carrying the same sentence. Setting
 * state to a string it already holds changes no text node, so nothing is spoken:
 * exactly the re-announcement the ids were built to produce would have been
 * swallowed. Clearing first guarantees a change either way.
 */
export function DraftAlertAnnouncer({ alerts }: { alerts: DraftAlert[] }) {
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = alerts.filter((a) => a.kind !== "your-turn" && !seen.current.has(a.id));
    if (fresh.length === 0) return;
    for (const a of fresh) seen.current.add(a.id);
    const message = fresh.map((a) => a.message).join(" ");
    setAnnouncement("");
    const timer = window.setTimeout(() => setAnnouncement(message), 60);
    return () => window.clearTimeout(timer);
  }, [alerts]);

  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </p>
  );
}

export function DraftRadar({
  alerts,
  picksUntilNext,
  nextPickLabel,
  goneBefore,
  boardReady,
  headingLevel = 2,
}: {
  alerts: DraftAlert[];
  picksUntilNext: number | null;
  /** e.g. "R3.07, pick 31 overall". Null when the user has no picks left. */
  nextPickLabel: string | null;
  goneBefore: GoneBeforeEntry[];
  boardReady: boolean;
  /**
   * Level for the panel title. The three subsection headings shift with it, so
   * this panel keeps a valid outline wherever it is mounted. The room passes 3
   * inside the mobile Quick info dialog, where these panels sit under the
   * dialog's own h2.
   */
  headingLevel?: 2 | 3;
}) {
  const Sub = headingLevel === 3 ? "h4" : "h3";
  return (
    <Panel
      eyebrow="Draft radar"
      title="What is happening"
      helper="Runs, tier cliffs, and who the market takes before your next pick."
      headingLevel={headingLevel}
    >
      <div className="space-y-4">
        <section aria-labelledby="otc-radar-turn">
          <Sub
            id="otc-radar-turn"
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            Your next pick
          </Sub>
          <p className="mt-1 text-sm text-ink">
            {picksUntilNext === null || nextPickLabel === null ? (
              "You have no picks left in this draft."
            ) : picksUntilNext === 0 ? (
              <span className="font-semibold text-amber-300">You are on the clock now.</span>
            ) : (
              <>
                <span className="font-mono text-lg font-bold tabular-nums text-brand-cyan">
                  {picksUntilNext}
                </span>{" "}
                {picksUntilNext === 1 ? "pick" : "picks"} away, at {nextPickLabel}.
              </>
            )}
          </p>
        </section>

        <section aria-labelledby="otc-radar-alerts">
          <Sub
            id="otc-radar-alerts"
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            <Radar aria-hidden="true" className="h-3.5 w-3.5" />
            Alerts
          </Sub>
          {alerts.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Nothing unusual on the board right now.</p>
          ) : (
            <ul role="list" className="mt-1 space-y-1.5">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-start gap-2 rounded-card border border-line bg-base/50 px-2.5 py-1.5 text-sm text-ink"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0">
                    {alert.kind === "run" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                    ) : (
                      <Layers className="h-3.5 w-3.5 text-brand-cyan" />
                    )}
                  </span>
                  <span>{alert.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="otc-radar-gone">
          <Sub
            id="otc-radar-gone"
            className="text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            Likely gone before your pick
          </Sub>
          {!boardReady ? (
            <p className="mt-1 text-sm text-ink-muted">Loading the board.</p>
          ) : goneBefore.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">
              {picksUntilNext === 0
                ? "You are up now, so nothing goes before you."
                : "Nobody is expected to go before your next pick."}
            </p>
          ) : (
            <ul role="list" className="mt-1 space-y-1">
              {goneBefore.map((entry) => (
                <li key={entry.player.playerId} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true" className="shrink-0">
                    <PlayerHeadshot
                      sleeperId={entry.player.sleeperId}
                      name=""
                      position={entry.player.position}
                      size={22}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {entry.player.name}
                    <span className="text-ink-subtle">, {entry.player.position}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-subtle">
                    #{entry.atPick}
                    {!entry.adpKnown && (
                      <span className="ml-1 text-[10px] uppercase text-amber-300" title="No Sleeper ADP for this player, so this is placed by FF Beacon rank">
                        est
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {goneBefore.some((g) => !g.adpKnown) && (
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Entries marked est carry no Sleeper ADP, so they are placed by FF Beacon rank instead.
            </p>
          )}
        </section>
      </div>
    </Panel>
  );
}
