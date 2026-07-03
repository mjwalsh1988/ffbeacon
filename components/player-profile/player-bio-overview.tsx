/**
 * Player overview: a dense, icon-labeled fact grid pulling everything we know
 * about a player from the players row and the raw Sleeper object preserved under
 * metadata.sleeper (jersey number, depth chart, birthplace, high school, injury,
 * etc). Every fact is a real dt/dd pair. Only facts we actually have render.
 * Server component.
 */

import {
  CalendarDays,
  Cake,
  Ruler,
  Dumbbell,
  Activity,
  GraduationCap,
  School,
  Hash,
  Flag,
  Shield,
  MapPin,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { sleeperMeta, type PlayerRow } from "@/lib/player-profile";

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function computeAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const parts = birthDate.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [y, m, d] = parts;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 80 ? age : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatBirthDate(birthDate: string | null): string | null {
  if (!birthDate) return null;
  const parts = birthDate.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [y, m, d] = parts;
  if (m < 1 || m > 12) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function heightDisplay(player: PlayerRow, meta: Record<string, unknown>): string | null {
  if (player.height_inches) {
    return `${Math.floor(player.height_inches / 12)}'${player.height_inches % 12}"`;
  }
  return str(meta.height);
}

export function PlayerBioOverview({ player }: { player: PlayerRow }) {
  const meta = sleeperMeta(player);

  const age = computeAge(player.birth_date) ?? (str(meta.age) ? Number(str(meta.age)) : null);
  const born = formatBirthDate(player.birth_date);
  const height = heightDisplay(player, meta);
  const weight = player.weight_lbs ? `${player.weight_lbs} lb` : str(meta.weight) ? `${str(meta.weight)} lb` : null;

  const yearsExp =
    player.years_experience ?? (str(meta.years_exp) ? Number(str(meta.years_exp)) : null);
  const experience =
    yearsExp === null ? null : yearsExp === 0 ? "Rookie" : `${yearsExp} yr${yearsExp === 1 ? "" : "s"}`;

  const college = player.college ?? str(meta.college);
  const highSchool = str(meta.high_school);
  const jersey = str(meta.number);
  const nestedMeta = (meta.metadata as Record<string, unknown> | undefined) ?? {};
  const rookieYear = str(nestedMeta.rookie_year);

  const birthplace = [str(meta.birth_city), str(meta.birth_state)].filter(Boolean).join(", ") || null;

  const draft =
    player.draft_year != null
      ? [
          player.draft_year,
          player.draft_round != null ? `Rd ${player.draft_round}` : null,
          player.draft_pick != null ? `Pk ${player.draft_pick}` : null,
        ]
          .filter(Boolean)
          .join(", ")
      : null;

  const facts: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Shield, label: "Position", value: player.position },
    ...(player.team ? [{ icon: Shield, label: "Team", value: player.team }] : []),
    ...(age != null ? [{ icon: CalendarDays, label: "Age", value: String(age) }] : []),
    ...(born ? [{ icon: Cake, label: "Born", value: born }] : []),
    ...(height ? [{ icon: Ruler, label: "Height", value: height }] : []),
    ...(weight ? [{ icon: Dumbbell, label: "Weight", value: weight }] : []),
    ...(experience ? [{ icon: Activity, label: "Experience", value: experience }] : []),
    ...(rookieYear ? [{ icon: Flag, label: "Rookie year", value: rookieYear }] : []),
    ...(jersey ? [{ icon: Hash, label: "Jersey", value: `#${jersey}` }] : []),
    ...(college ? [{ icon: GraduationCap, label: "College", value: college }] : []),
    ...(highSchool ? [{ icon: School, label: "High school", value: highSchool }] : []),
    ...(birthplace ? [{ icon: MapPin, label: "Birthplace", value: birthplace }] : []),
    ...(draft ? [{ icon: Trophy, label: "Draft", value: draft }] : []),
  ];

  return (
    <Panel eyebrow="Player" title="Overview" helper="Everything on file for this player.">
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {facts.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.label} className="rounded-card border border-line bg-base/50 px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {f.label}
              </dt>
              <dd className="mt-1 text-sm font-medium text-ink">{f.value}</dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}
