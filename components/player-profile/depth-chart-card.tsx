/**
 * Depth chart card (overview). Shows the whole position room for the player's
 * team, ordered starter-first by Sleeper's depth_chart_order, with the viewed
 * player highlighted and every player tagged with a plain-language role via the
 * shared RoleBadge. Teammate names link to their own profiles. The parent hides
 * this card entirely when no depth data exists, so it never renders empty.
 * Server component.
 */

import Link from "next/link";
import { Panel } from "@/components/dashboard-panel";
import { PlayerHeadshot } from "@/components/player-headshot";
import { RoleBadge, roleBadgeClass } from "@/components/player-profile/role-badge";
import type { DepthChartEntry } from "@/lib/player-profile";

export function DepthChartCard({
  room,
  viewedRole,
  position,
  playerName,
}: {
  room: DepthChartEntry[];
  viewedRole: string | null;
  position: string;
  playerName: string;
}) {
  return (
    <Panel
      eyebrow="Situation"
      title="Depth chart"
      helper={`Where ${playerName} sits in the ${position} room`}
      action={viewedRole ? <RoleBadge role={viewedRole} /> : undefined}
    >
      <ol className="space-y-1.5">
        {room.map((e) => (
          <li
            key={e.slug}
            className={`flex items-center gap-3 rounded-card border px-3 py-2 ${
              e.isViewed ? "border-brand-cyan/60 bg-brand-cyan/[0.06]" : "border-line bg-base/40"
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface font-mono text-xs font-bold tabular-nums text-ink-muted"
            >
              {e.order ?? "-"}
            </span>
            <PlayerHeadshot
              sleeperId={e.sleeperId}
              name=""
              size={32}
              rounded={false}
              className="!rounded-md shrink-0"
            />
            <div className="min-w-0 flex-1">
              {e.isViewed ? (
                <span className="text-sm font-semibold text-ink">
                  {e.name}
                  <span className="sr-only"> (this player)</span>
                </span>
              ) : (
                <Link
                  href={`/players/${e.slug}`}
                  className="text-sm font-medium text-ink transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {e.name}
                </Link>
              )}
            </div>
            {e.injuryStatus && (
              <span className="shrink-0 rounded-full bg-signal-warning/15 px-2 py-0.5 text-[11px] font-medium text-signal-warning">
                {e.injuryStatus}
              </span>
            )}
            {e.role && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleBadgeClass(
                  e.role,
                )}`}
              >
                {e.role}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
