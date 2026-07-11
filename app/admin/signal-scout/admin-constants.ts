/**
 * Shared constants for the Signal Scout admin area. Lives outside actions.ts
 * because a "use server" module may only export async functions at runtime
 * (a non-function export fails next build even though tsc accepts it; same
 * class of restriction as the Phase 4 route-file export finding).
 */

export const ADMIN_NOTE_MAX = 300;
