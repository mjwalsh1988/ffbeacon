"use client";

/**
 * A way for a page to name itself in the breadcrumb bar.
 *
 * The bar derives its trail from the pathname, which is right for the ninety
 * routes whose last segment reads fine as words. It is wrong for the ones whose
 * last segment is an identifier: an article slug is not its headline, "KC" is
 * not "Kansas City Chiefs", and "ja-marr-chase" cannot be turned back into
 * "Ja'Marr Chase" by any amount of humanizing.
 *
 * Those pages render `<SetBreadcrumbLabel value="..." />` and the bar uses that
 * for the last crumb instead.
 *
 * Registration happens in an effect, so the served HTML carries the humanized
 * slug and the real label lands with hydration. That is acceptable here and
 * nowhere else: every route that needs an override already publishes its own
 * BreadcrumbList with the correct labels in the server-rendered markup, so what
 * a crawler reads is right either way, and the bar is a static trail rather
 * than a live region, so a reader is not interrupted by the swap.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type BreadcrumbLabelState = {
  label: string | null;
  setLabel: (next: string | null) => void;
};

const BreadcrumbLabelContext = createContext<BreadcrumbLabelState | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return (
    <BreadcrumbLabelContext.Provider value={value}>
      {children}
    </BreadcrumbLabelContext.Provider>
  );
}

export function useBreadcrumbLabel(): BreadcrumbLabelState {
  return useContext(BreadcrumbLabelContext) ?? { label: null, setLabel: () => {} };
}

/** Renders nothing. Names the current page in the breadcrumb bar. */
export function SetBreadcrumbLabel({ value }: { value: string }) {
  const { setLabel } = useBreadcrumbLabel();

  useEffect(() => {
    setLabel(value);
    return () => setLabel(null);
  }, [value, setLabel]);

  return null;
}
