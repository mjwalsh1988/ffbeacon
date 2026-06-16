// Shared constants and types for the Signal customization editors (accent,
// links, favorites). These live outside actions.ts because a "use server" file
// may only export async functions, not constants. Both the server actions and
// the client editors import from here.

/** Custom-link limits, mirrored by the DB shape guard (migration 0069). */
export const LINK_LABEL_MAX = 40;
export const LINK_URL_MAX = 2048;
export const LINKS_MAX = 10;

export type SignalLink = { label: string; url: string };

export type PlayerSearchResult = {
  id: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
};
