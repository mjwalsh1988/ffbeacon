"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import type { ProductPlacement } from "@/lib/commerce/types";

/** Counts an offer once per mount. Paints nothing. */
export function OfferView({ placement }: { placement: ProductPlacement }) {
  useEffect(() => {
    trackEvent("review_offer_view", { placement });
  }, [placement]);
  return null;
}
