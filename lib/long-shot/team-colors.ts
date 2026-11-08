/**
 * NFL team colors for the kick trail (plan 18A.1), the one place team colors
 * appear in Long Shot. Read server-side from nfl_teams and carried to the
 * browser only inside the answer response.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { TeamTonesDto } from "./types";

type Client = SupabaseClient<Database>;

export interface TeamColorRow {
  abbreviation: string;
  primary_color: string | null;
  secondary_color: string | null;
  tertiary_color: string | null;
}

const HEX = /^#?([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function normalize(hex: string | null): string | null {
  if (!hex) return null;
  const m = HEX.exec(hex.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** True when every channel of the two colors is within 24 of the other. */
export function tooClose(a: string, b: string): boolean {
  const x = channels(a);
  const y = channels(b);
  if (!x || !y) return false;
  return x.every((v, i) => Math.abs(v - y[i]) <= 24);
}

/**
 * The two trail tones: primary above the line, secondary below, with the
 * tertiary swapped in for the lower tone when primary and secondary are too
 * close to read as two. Null for a missing team or a team with no colors.
 */
export function trailTones(
  primary: string | null,
  secondary: string | null,
  tertiary: string | null,
): { upper: string; lower: string } | null {
  const p = normalize(primary);
  const s = normalize(secondary);
  const t = normalize(tertiary);
  if (!p || !s) return null;
  if (tooClose(p, s) && t) return { upper: p, lower: t };
  return { upper: p, lower: s };
}

/** Pure: the DTO for one team code, or null when it has no usable row. */
export function teamTonesFor(
  code: string | null,
  rows: readonly TeamColorRow[],
): TeamTonesDto | null {
  if (!code) return null;
  const row = rows.find((r) => r.abbreviation === code);
  if (!row) return null;
  const tones = trailTones(
    row.primary_color,
    row.secondary_color,
    row.tertiary_color,
  );
  if (!tones) return null;
  return {
    code,
    primary: tones.upper,
    secondary: tones.lower,
    tertiary: normalize(row.tertiary_color),
  };
}

/** Every team's colors, one select, held for 24 hours. */
export async function loadTeamColors(admin: Client): Promise<TeamColorRow[]> {
  try {
    const cached = unstable_cache(
      async () => {
        const { data, error } = await admin
          .from("nfl_teams")
          .select(
            "abbreviation, primary_color, secondary_color, tertiary_color",
          );
        if (error) throw new Error(`team colors read failed: ${error.message}`);
        return (data ?? []) as TeamColorRow[];
      },
      ["long-shot-team-colors"],
      { revalidate: 86_400 },
    );
    return await cached();
  } catch {
    return [];
  }
}
