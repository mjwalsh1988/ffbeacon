export function readPosition(input: string | string[] | undefined): string | null {
  const candidate = Array.isArray(input) ? input[0] : input;
  if (!candidate) return null;
  const upper = candidate.toUpperCase();
  return ["QB", "RB", "WR", "TE", "K", "DEF"].includes(upper) ? upper : null;
}
