/**
 * Player age helpers.
 *
 * Age is derived from `players.birth_date` (an ISO `YYYY-MM-DD` string). Two
 * flavors exist on purpose:
 *
 * - `computeAgeYears` returns WHOLE years. Use it for logic and thresholds
 *   (youth scoring, "age risk" gating, tiering, sorting) where a stable integer
 *   is expected.
 * - `computeAgeDecimal` / `formatAge` return the EXACT age carried to one
 *   decimal place (e.g. 23.4). Use these for anything shown to the user, so the
 *   front end displays a precise age instead of a rounded whole number.
 *
 * Both parse the date as UTC calendar components (matching how Sleeper stores
 * birth dates) and reject implausible results (<0 or >=80 years).
 */

function parseBirthDate(
  birthDate: string | null | undefined,
): { y: number; m: number; d: number } | null {
  if (!birthDate) return null;
  const parts = birthDate.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [y, m, d] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Whole-years age from an ISO birth date, or null. For logic/thresholds. */
export function computeAgeYears(
  birthDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const parsed = parseBirthDate(birthDate);
  if (!parsed) return null;
  const { y, m, d } = parsed;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m ||
    (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 80 ? age : null;
}

/**
 * Exact age from an ISO birth date as a fractional number, or null.
 *
 * Calendar-anchored: it is exactly a whole number on a birthday and grows
 * toward the next birthday as the fraction of the year elapsed. This avoids the
 * drift a naive "days / 365.25" would introduce. For DISPLAY only, via
 * `formatAge`; callers that need a stable integer must use `computeAgeYears`.
 */
export function computeAgeDecimal(
  birthDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const parsed = parseBirthDate(birthDate);
  if (!parsed) return null;
  const { y, m, d } = parsed;

  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  // Most recent birthday on or before today.
  let lastBirthdayYear = now.getUTCFullYear();
  if (Date.UTC(lastBirthdayYear, m - 1, d) > todayUtc) lastBirthdayYear -= 1;

  const lastBirthday = Date.UTC(lastBirthdayYear, m - 1, d);
  const nextBirthday = Date.UTC(lastBirthdayYear + 1, m - 1, d);

  const wholeYears = lastBirthdayYear - y;
  const span = nextBirthday - lastBirthday;
  const fraction = span > 0 ? (todayUtc - lastBirthday) / span : 0;
  const age = wholeYears + fraction;

  return age >= 0 && age < 80 ? age : null;
}

/**
 * Format a player's exact age for display, carried to one decimal place
 * (e.g. "23.4"), or null when there is no usable birth date.
 */
export function formatAge(
  birthDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const age = computeAgeDecimal(birthDate, now);
  return age == null ? null : age.toFixed(1);
}

/**
 * Format an already-computed numeric age to one decimal place (e.g. "24" ->
 * "24.0"), or null. Use this only at DISPLAY sites where a raw birth date is
 * not available and the value was computed upstream (for example a Sleeper
 * `metadata.age` fallback). Prefer `formatAge` from a birth date whenever one
 * exists, since it carries the true fractional precision.
 */
export function formatAgeNumber(
  age: number | null | undefined,
): string | null {
  if (age == null || !Number.isFinite(age)) return null;
  return age.toFixed(1);
}
