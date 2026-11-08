/**
 * The Hurry-Up server clock (plan 8.2). Pure.
 *
 * limitMs comes from the attempt's frozen timer_seconds; graceMs is read live
 * from settings because it only absorbs network latency. The client is told
 * remainingMs WITHOUT grace and never learns grace exists.
 */

export function isExpired(servedAt: Date | string, limitMs: number, graceMs: number, now: Date): boolean {
  return now.getTime() > new Date(servedAt).getTime() + limitMs + graceMs;
}

export function remainingMs(servedAt: Date | string, limitMs: number, now: Date): number {
  return Math.max(0, new Date(servedAt).getTime() + limitMs - now.getTime());
}
