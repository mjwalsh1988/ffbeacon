export { ManagerShell, MANAGER_SHELL_MAIN_ID } from "./manager-shell";
export {
  ManagerRailSections,
  MANAGER_RAIL_SECTION_ID,
  useManagerActiveSection,
} from "./manager-rail-sections";
export { ManagerMobileNav } from "./manager-mobile-nav";
export { LensSwitch } from "./lens-switch";
// The pure helpers come from ./lens, NOT from ./lens-switch. That file carries
// "use client", and every export of a client module becomes a throwing client
// reference when a server component calls it. Six of them do.
export {
  underLens,
  perTypeUnderLens,
  perTypeSlice,
  defaultLens,
  lensLabel,
  type LensCounts,
} from "./lens";
export {
  MANAGER_NAV_ITEMS,
  managerSectionElementId,
  managerSectionHref,
  type ManagerNavItem,
  type ManagerSection,
} from "./nav-items";
