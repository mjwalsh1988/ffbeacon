"use client";

/**
 * A way for a route to add its own section to the navigation rail.
 *
 * League Pulse is the reason this exists. Once you are inside a league, the
 * five league sections are the navigation you actually want, but they are only
 * knowable from the page, and the rail lives in the layout above it. Rather
 * than give a league its own second rail, the league shell registers its
 * sections here and the one rail grows a "This league" entry at the top,
 * opened to its second level, with every site section still one Back press
 * away.
 *
 * Registration happens in an effect, so the rail paints the site sections first
 * and the league sections arrive with hydration. That ordering is deliberate:
 * the site sections are correct for every route and never need to wait on
 * anything, and the league page renders its own heading and content
 * independently of the rail.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NavNode } from "@/lib/nav-types";

/** Which row inside a contributed section is the current page. */
export type RailActive = { sectionId: string; childId: string | null } | null;

type RailSectionsState = {
  /** Sections contributed by the current route, prepended to the site tree. */
  extra: NavNode[];
  /** The section to open on arrival, when the route wants one open. */
  openId: string | null;
  /**
   * The current row, when the route knows it better than the URL does. League
   * sections differ by query string (`?tab=teams`), and a pathname match cannot
   * tell those apart, so the league page states which one it is.
   */
  active: RailActive;
  register: (sections: NavNode[], openId: string | null, active: RailActive) => void;
  clear: () => void;
};

const RailSectionsContext = createContext<RailSectionsState | null>(null);

export function RailSectionsProvider({ children }: { children: ReactNode }) {
  const [extra, setExtra] = useState<NavNode[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [active, setActive] = useState<RailActive>(null);

  // Both are stable for the life of the provider, because the only things they
  // close over are React's own setters. That is what lets the registrar list
  // them as effect dependencies: rebuilding them on every state change would
  // mean register -> setState -> new identity -> effect re-runs, forever.
  const register = useCallback(
    (sections: NavNode[], nextOpenId: string | null, nextActive: RailActive) => {
      setExtra(sections);
      setOpenId(nextOpenId);
      setActive(nextActive);
    },
    [],
  );

  const clear = useCallback(() => {
    setExtra([]);
    setOpenId(null);
    setActive(null);
  }, []);

  const value = useMemo<RailSectionsState>(
    () => ({ extra, openId, active, register, clear }),
    [extra, openId, active, register, clear],
  );

  return (
    <RailSectionsContext.Provider value={value}>{children}</RailSectionsContext.Provider>
  );
}

export function useRailSections(): RailSectionsState {
  return (
    useContext(RailSectionsContext) ?? {
      extra: [],
      openId: null,
      active: null,
      register: () => {},
      clear: () => {},
    }
  );
}

/**
 * Drop this anywhere inside a route to contribute its sections to the rail.
 * Renders nothing.
 */
export function RegisterRailSections({
  sections,
  openId = null,
  active = null,
}: {
  sections: NavNode[];
  openId?: string | null;
  active?: RailActive;
}) {
  const { register, clear } = useRailSections();
  // The sections array is rebuilt on every render of the caller, so its
  // identity is not a useful dependency. Its content is, flattened to a string
  // the effect can compare. The labels are in it because a section can be
  // renamed in place: a draft room's section is named for the league, which
  // arrives after the first render. `sections` and `active` are read through refs so
  // they are current without being dependencies.
  const signature = sections
    .map(
      (s) =>
        `${s.id}:${s.href ?? ""}:${s.label}:${(s.children ?? [])
          .map((c) => `${c.id}:${c.href ?? ""}:${c.label}`)
          .join(",")}`,
    )
    .join("|");
  const activeKey = active ? `${active.sectionId}:${active.childId ?? ""}` : "";

  const latest = useRef({ sections, active });
  latest.current = { sections, active };

  useEffect(() => {
    const { sections: current, active: currentActive } = latest.current;
    register(current, openId, currentActive);
  }, [signature, openId, activeKey, register]);

  // Clearing is a separate effect so it runs on unmount and nowhere else.
  // Returning it from the register effect meant every re-registration blanked
  // the rail and restored it, which is only invisible because React batches the
  // two. `register` replaces the contributed sections outright rather than
  // appending, so nothing goes stale by not clearing first.
  useEffect(() => clear, [clear]);

  return null;
}
