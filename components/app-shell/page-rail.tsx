"use client";

/**
 * How a page puts its own content in the dashboard's right-hand rail.
 *
 * The rail is rendered by the layout, and the content that belongs in it on a
 * draft board is owned by a client component several levels down, with its own
 * state and its own callbacks. Passing that up through props would mean lifting
 * the whole draft room into the layout.
 *
 * So the layout renders an empty slot and the page renders INTO it with a
 * portal. A portal keeps the content exactly where it is in the React tree, so
 * its state, its context, and its event handlers all still work; only the DOM
 * node it lands in is somewhere else.
 *
 * Whether the rail belongs to the page at all is a separate question, decided
 * from the pathname in lib/dashboard-rail.ts. It has to be, because that
 * decision changes the layout and must be right in the server-rendered HTML.
 * This file only moves the content.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type PageRailState = {
  slot: HTMLElement | null;
  setSlot: (node: HTMLElement | null) => void;
};

const PageRailContext = createContext<PageRailState | null>(null);

export function PageRailProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <PageRailContext.Provider value={value}>{children}</PageRailContext.Provider>;
}

/** The layout side: a ref callback to attach to the empty rail slot. */
export function usePageRailSlot(): (node: HTMLElement | null) => void {
  const context = useContext(PageRailContext);
  const setSlot = context?.setSlot;
  return useCallback(
    (node: HTMLElement | null) => {
      setSlot?.(node);
    },
    [setSlot],
  );
}

/**
 * The page side. Renders nothing where it sits; puts its children in the rail.
 *
 * Nothing on the first client render, because the slot node is only known after
 * the layout has committed. That is invisible here: the rail is empty in the
 * server HTML for a page that owns it, so there is nothing to flash away.
 */
export function PageRail({ children }: { children: ReactNode }) {
  const context = useContext(PageRailContext);
  if (!context?.slot) return null;
  return createPortal(children, context.slot);
}
