/**
 * The shape of a navigation section, and the lookup that says which one you are
 * currently inside.
 *
 * Split out from `lib/nav-tree.ts` so the rail (a client component) can import
 * the type and the lookup without importing the tree itself. The tree lists
 * every admin route on the site, and shipping that to a signed-out visitor
 * hands them a map of the admin surface for the cost of one `curl`. The tree is
 * therefore server-only and arrives at the rail already filtered for who is
 * looking; this file is the part that is safe everywhere.
 *
 * A node names its icon rather than carrying the component, because a component
 * cannot cross the server-to-client boundary. `components/app-shell/nav-icons.ts`
 * resolves the name.
 *
 * Most rows are links. A row can instead switch something in place, by carrying
 * `onSelect` and no `href`: On The Clock's draft views are eight states of one
 * live page rather than eight routes, and reloading a draft room to change view
 * would be the wrong trade. Only a route contributing its own sections from the
 * client sets that, so no function is ever asked to cross a boundary.
 */

import type { Route } from "next";
import type { NavIconName } from "@/components/app-shell/nav-icons";

/** Who a section is for. Sections with no `requires` are for everyone. */
export type NavAudience = "authenticated" | "admin";

type NavNodeBase = {
  /** Stable id, used for the rail's panel keys and the active-trail lookup. */
  id: string;
  label: string;
  /** One plain line under the label. Painted in the second level and the mobile
   *  drawer, and carried in the accessible name of the rail row. */
  hint: string;
  icon: NavIconName;
  requires?: NavAudience;
  /** Label for the row that links to `href` itself, above the children. Nothing
   *  is rendered when the section has no `href`. */
  indexLabel?: string;
  children?: NavNode[];
};

/**
 * A row does exactly one of two things, and the type says so. Without the
 * union a node could carry neither, which renders a focusable, labelled row
 * that does nothing when pressed.
 */
export type NavNode = NavNodeBase &
  (
    | {
        /** Where the row goes. */
        href: Route;
        onSelect?: never;
      }
    | {
        /** A section with no page of its own, or a row that switches a view. */
        href?: undefined;
        /**
         * Switches a view in place instead of navigating. Client-set only: a
         * section registered through `RegisterRailSections` lives entirely
         * inside the client tree, so a function here never has to serialise.
         *
         * Optional on a section, which is opened by pressing it rather than
         * activated. Required on a leaf, which would otherwise do nothing.
         */
        onSelect?: () => void;
        children?: NavNode[];
      }
  );

/**
 * A section in the site tree, which is built on the server and serialised into
 * the rail. Every row is a link, and `onSelect` is not part of the shape, so a
 * function cannot be put on one by accident: `lib/nav-tree.ts` types its own
 * sections as these, and Next would refuse to serialise a function anyway.
 * Rows that switch a view in place are contributed from the client and use the
 * wider `NavNode`.
 */
export type SiteNavNode = NavNodeBase & {
  href: Route;
  children?: SiteNavNode[];
};

/** What the rail knows about the person looking at it. */
export type NavViewer = {
  isAuthenticated: boolean;
  isAdmin: boolean;
};

/**
 * Which section (and, when there is one, which child) a pathname sits under.
 * Longest matching href wins, so `/tools/faab` resolves to the FAAB child
 * rather than stopping at the Tools section. `/` only ever matches itself.
 */
export function findActiveTrail(
  tree: NavNode[],
  pathname: string,
): { sectionId: string | null; childId: string | null } {
  let sectionId: string | null = null;
  let childId: string | null = null;
  let bestLength = 0;

  const consider = (node: NavNode, parentId: string | null) => {
    // A row that switches a view in place has no href and no pathname to match.
    // Its route says which row is current through `active` on the registration.
    if (!node.href) return;
    const href = (node.href as string).split("?")[0];
    const matches =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (!matches || href.length < bestLength) return;
    bestLength = href.length;
    sectionId = parentId ?? node.id;
    childId = parentId ? node.id : null;
  };

  for (const section of tree) {
    consider(section, null);
    for (const child of section.children ?? []) consider(child, section.id);
  }

  return { sectionId, childId };
}
