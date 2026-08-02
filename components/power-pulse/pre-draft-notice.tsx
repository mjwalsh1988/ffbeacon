import { CalendarClock } from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { LeagueReadiness } from "@/lib/league-readiness";
import { describeReadinessGap } from "@/lib/league-readiness";

export type PreDraftTeam = {
  rosterRowId: string;
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
};

/**
 * What a league sees before it has drafted.
 *
 * The alternative was what this replaces: a full Power Pulse table where every
 * team scored 1, every playoff chance read 0%, and the order was whatever the
 * tie-break happened to produce. That looks like a broken feature rather than
 * an empty one, and readers reasonably assumed the numbers meant something.
 *
 * So the numbers are gone and the teams stay. Seeing the twelve managers who
 * will be in the room is still worth the visit, and it makes the state read as
 * "waiting" rather than "failed".
 */
export function PreDraftNotice({
  readiness,
  teams,
  season,
  variant = "full",
}: {
  readiness: LeagueReadiness;
  teams: PreDraftTeam[];
  season: number | string | null;
  /**
   * `full` is the Power Pulse tab, where this is the whole page.
   * `inline` sits above the overview's team list, where the list itself is
   * still rendered by the caller.
   */
  variant?: "full" | "inline";
}) {
  const gap = describeReadinessGap(readiness);
  const heading =
    variant === "full"
      ? "Power Pulse starts after your draft"
      : "No meaningful order yet";

  return (
    <div
      className={
        variant === "full"
          ? "relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          : "rounded-card border border-signal-warning/35 bg-signal-warning/5 p-4"
      }
      style={
        variant === "full"
          ? {
              backgroundImage:
                "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.09) 0%, transparent 60%)",
            }
          : undefined
      }
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
        >
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {heading}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {gap} Power Pulse scores a real starting lineup week by week against
            the opponents you were dealt, so until both of those exist there is
            nothing honest to rank.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {variant === "full"
              ? `Come back once your ${season ?? ""} draft wraps and the schedule posts. Every team below will have a score, projected record, and playoff odds on your first visit after that.`
              : "The teams below are listed for reference. Their order is not a ranking yet."}
          </p>
        </div>
      </div>

      {variant === "full" && teams.length > 0 && (
        <section aria-labelledby="pre-draft-teams" className="mt-6">
          <h3
            id="pre-draft-teams"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle"
          >
            In this league
          </h3>
          <ul
            role="list"
            className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          >
            {teams.map((team) => (
              <li
                key={team.rosterRowId}
                className="flex items-center gap-2.5 rounded-card border border-line bg-base/60 px-3 py-2.5"
              >
                <SleeperAvatar
                  avatarId={team.ownerAvatarId}
                  initial={team.teamName.charAt(0)}
                  title={team.teamName}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {team.teamName}
                  </span>
                  {team.ownerHandle && (
                    <span className="block truncate text-[11px] text-ink-subtle">
                      @{team.ownerHandle}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-subtle">
            Listed in roster order, which is the order Sleeper assigned. It is
            not a ranking.
          </p>
        </section>
      )}
    </div>
  );
}
