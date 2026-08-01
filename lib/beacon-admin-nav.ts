/**
 * Registry of the Values, Rankings, & Sources admin sub-pages. Single source of
 * truth for both the parent landing index and the in-section sub-navigation, so
 * adding a sub-page is one edit and it appears in both places.
 */

export const BEACON_SUBPAGES = [
  {
    href: "/admin/beacon/rankings",
    label: "Rankings & Values",
    description:
      "Review every player's value, rank, and 7d/30d/90d movement by format and position, with the full per-player signal breakdown, plus draft pick values for every source.",
  },
  {
    href: "/admin/beacon/sources",
    label: "Sources",
    description: "Enable or disable each value source in the blend.",
  },
  {
    href: "/admin/beacon/weights",
    label: "Signal weights",
    description: "Weight, confidence cap, and enable toggle for each signal and source.",
  },
  {
    href: "/admin/beacon/bands",
    label: "Value bands",
    description: "Global and per-format position value ranges.",
  },
  {
    href: "/admin/beacon/settings",
    label: "Settings",
    description: "Factor clamp, staleness thresholds, normalization, TEP derivation, and the AI slot.",
  },
  {
    href: "/admin/beacon/calibration",
    label: "Calibration",
    description:
      "The stored consensus scale behind calibrated normalization: which version is live per format, how old it is, the last drift check, rebuild and rollback.",
  },
  {
    href: "/admin/beacon/manual",
    label: "Manual signals",
    description: "Create owner nudges and manage active manual signals.",
  },
  {
    href: "/admin/beacon/runs",
    label: "Runs & monitoring",
    description: "Recompute run observability and the live status of every cron job.",
  },
] as const;
