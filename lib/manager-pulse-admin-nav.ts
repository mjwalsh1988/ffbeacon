/**
 * Registry of the Manager Pulse admin sub-pages. Single source of truth for
 * both the parent landing index and the in-section sub-navigation, so adding a
 * sub-page is one edit and it appears in both places.
 */

export const MANAGER_PULSE_SUBPAGES = [
  {
    href: "/admin/manager-pulse",
    label: "Settings",
    description: "Every limit, cooldown and sample floor behind the tool.",
  },
  {
    href: "/admin/manager-pulse/runs",
    label: "Runs",
    description: "Recent lookups, how far each got, and what failed.",
  },
  {
    href: "/admin/manager-pulse/cache",
    label: "Cache",
    description: "Stored reports and tendencies, and how to clear them.",
  },
  {
    href: "/admin/manager-pulse/observations",
    label: "Draft clock",
    description: "How much per-pick timing we have measured so far.",
  },
] as const;
