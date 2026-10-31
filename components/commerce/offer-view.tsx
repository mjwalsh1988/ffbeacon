"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/** Counts an offer once per mount. Paints nothing. */
export function OfferView({ placement }: { placement: "blueprint" | "league-overview" | "my-beacon" }) {
  useEffect(() => {
    trackEvent("review_offer_view", { placement });
  }, [placement]);
  return null;
}
