/**
 * What the site knows about a reader's Sleeper identity, and who a given
 * surface is acting for.
 *
 * The rules these types exist to carry, in short:
 *
 *   D1  One resolver. `lib/sleeper-handle/resolve.ts` is the only module that
 *       reads `sleeper_league_settings.username`, and `guard.test.ts` fails
 *       the suite if anything else does. Seven scattered copies is how the
 *       username-versus-display-name gap below went unnoticed.
 *   D2  `?username=` wins over the saved handle, always. It is the
 *       shareable-link mechanism, and a reader following someone else's link
 *       sees that person's leagues. `source` records which one won, so the
 *       identity card can say so in words.
 *   D3  The saved identity carries the Sleeper user id, resolved at save
 *       time. Roster matching prefers it, because a Sleeper USERNAME and a
 *       Sleeper DISPLAY NAME are different strings and the deep views match
 *       on the display name. It also saves one Sleeper call per visit.
 *   D4  When the card is shown the search form is UNMOUNTED, not hidden. A
 *       hidden form still holds a focusable input for a keyboard reader.
 *   D5  Change is a one-off lookup unless the reader ticks the save box.
 */

/** The identity stored on `user_preferences.sleeper_league_settings`. */
export type SavedSleeperHandle = {
  /** The handle, lowercased by saveSleeperHandle. Sleeper is case-insensitive. */
  username: string;
  /** Null for a row saved before migration 0268; the resolver fills it lazily. */
  sleeperUserId: string | null;
  displayName: string | null;
  avatar: string | null;
  /** ISO time of the last successful resolution on Sleeper. */
  verifiedAt: string | null;
};

export type SleeperViewerSource = "url" | "saved";

/**
 * Who a surface is acting for. `username` is what goes into links and
 * lookups; `sleeperUserId` is what roster matching prefers (D3).
 */
export type SleeperViewer = {
  username: string;
  sleeperUserId: string | null;
  displayName: string | null;
  avatar: string | null;
  source: SleeperViewerSource;
};

/**
 * The four states every username surface renders one of.
 *
 *   guest              signed out                        form + notice
 *   member-unsaved     signed in, no handle              form (save on) + notice
 *   member-saved       signed in, handle, clean URL      card, auto-run, no form
 *   member-overridden  signed in, handle, ?username=x    card in "from this link" mode
 */
export type HandleGateState =
  | { kind: "guest" }
  | { kind: "member-unsaved" }
  | { kind: "member-saved"; handle: SavedSleeperHandle }
  | {
      kind: "member-overridden";
      handle: SavedSleeperHandle;
      viewer: SleeperViewer;
    };

/** The viewer a gate state is acting for, or null when there is none. */
export function gateViewer(state: HandleGateState): SleeperViewer | null {
  if (state.kind === "member-overridden") return state.viewer;
  if (state.kind === "member-saved") {
    return {
      username: state.handle.username,
      sleeperUserId: state.handle.sleeperUserId,
      displayName: state.handle.displayName,
      avatar: state.handle.avatar,
      source: "saved",
    };
  }
  return null;
}

/** The saved handle a gate state carries, or null. */
export function gateHandle(state: HandleGateState): SavedSleeperHandle | null {
  return state.kind === "member-saved" || state.kind === "member-overridden"
    ? state.handle
    : null;
}

/**
 * The `?username=` value a link built inside a league view should carry, or
 * null when it should carry none.
 *
 * Only a reader who ARRIVED on `?username=` keeps it. A reader on their own
 * saved identity navigates between tabs on clean URLs, so a link they copy and
 * send resolves to the RECIPIENT's saved handle, which is the correct reading
 * of "your team". Forwarding the sender's handle instead would show every
 * recipient somebody else's roster highlighted as if it were their own.
 */
export function viewerLinkUsername(
  viewer: SleeperViewer | null | undefined,
): string | null {
  return viewer && viewer.source === "url" ? viewer.username : null;
}
