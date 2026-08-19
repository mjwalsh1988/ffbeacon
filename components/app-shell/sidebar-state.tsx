"use client";

/**
 * Whether the rail is open, shared between the rail itself and the header sat
 * above it (the header's brand cell has to match the rail's width, and the
 * wordmark beside the logo only shows when the rail is open).
 *
 * The visible width is not driven from here. It comes from `data-sidebar` on
 * <html>, which a blocking script in app/layout.tsx sets from localStorage
 * before the first paint, and from the `--app-rail-w` custom property that
 * attribute selects. See app/globals.css. This context exists so the toggle
 * button can carry a truthful `aria-expanded`, and so the mobile drawer has
 * somewhere to keep its open state.
 *
 * Initial state matches what the server renders (open), and is reconciled from
 * the DOM attribute in an effect. Nothing visible depends on that
 * reconciliation, so there is no flash.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "ffbeacon:sidebar-expanded";

type SidebarState = {
  expanded: boolean;
  toggle: () => void;
  /** Opens the rail without closing it if it is already open. */
  open: () => void;
  mobileOpen: boolean;
  setMobileOpen: (next: boolean) => void;
};

const SidebarContext = createContext<SidebarState | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setExpanded(document.documentElement.dataset.sidebar === "expanded");
  }, []);

  const apply = useCallback((next: boolean) => {
    setExpanded(next);
    document.documentElement.dataset.sidebar = next ? "expanded" : "collapsed";
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Private mode or blocked storage. The choice still applies to this view.
    }
  }, []);

  const toggle = useCallback(() => apply(!expanded), [apply, expanded]);
  const open = useCallback(() => {
    if (!expanded) apply(true);
  }, [apply, expanded]);

  const value = useMemo(
    () => ({ expanded, toggle, open, mobileOpen, setMobileOpen }),
    [expanded, toggle, open, mobileOpen],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used inside <SidebarProvider>");
  }
  return ctx;
}

/**
 * The blocking script that re-applies the remembered rail width before the
 * first paint. Rendered once, in <head>, by app/layout.tsx.
 *
 * The rail opens by default. Only an explicit "0" collapses it, so someone who
 * has never touched the toggle sees the section names rather than a column of
 * icons they have to hover to read.
 */
export const SIDEBAR_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});document.documentElement.dataset.sidebar=v==="0"?"collapsed":"expanded";}catch(e){document.documentElement.dataset.sidebar="expanded";}})();`;
