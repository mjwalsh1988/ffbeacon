/**
 * How a roster or player trade value is written out.
 *
 * Four-figure values get thousands separators and no decimals, because that is
 * how people read them aloud. Smaller ones stay whole too: a value is a ranking
 * quantity, and a decimal point on it implies a precision the model does not
 * claim.
 *
 * Lived inside components/team-card.tsx until the league list needed the same
 * numbers. Two copies of a formatter is how two surfaces start disagreeing
 * about what the same value is.
 */
export function formatValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  const n = Number(v);
  return n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(0);
}
