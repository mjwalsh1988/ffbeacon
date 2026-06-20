/**
 * Registry of the My Signal editor sub-pages. Single source of truth for the
 * in-section sub-navigation, the wizard checklist (shown before a profile has
 * ever been published), and the card hub (shown after launch). Adding or
 * reordering a step is one edit here and it flows to all three surfaces.
 *
 * The "handle" step is special: it is the gate. A reader cannot reach any other
 * sub-page until a handle exists, so it always leads the list and is always
 * complete by the time the rest are reachable.
 */

import {
  AtSign,
  IdCard,
  Star,
  LayoutPanelTop,
  MessageSquare,
  Globe,
  type LucideIcon,
} from "lucide-react";

export type SignalStepKey =
  | "handle"
  | "identity"
  | "showcase"
  | "layout"
  | "wall"
  | "visibility";

export type SignalSubpage = {
  key: SignalStepKey;
  href: string;
  /** Short tab/card label. */
  label: string;
  icon: LucideIcon;
  /** One-line summary for the card hub and sub-nav aria descriptions. */
  summary: string;
  /** Plain-language heading for the wizard step. */
  wizardTitle: string;
  /** Plain-language explanation of what this step does and why it helps. */
  wizardBody: string;
  /** Verb on the wizard step's action button. */
  cta: string;
};

export const SIGNAL_SUBPAGES: readonly SignalSubpage[] = [
  {
    key: "handle",
    href: "/my-beacon/signal/handle",
    label: "Handle",
    icon: AtSign,
    summary: "Your public address and the link people share.",
    wizardTitle: "Claim your handle",
    wizardBody:
      "This is your public address, the short link people type or share to find you. You can change it later, once every 30 days.",
    cta: "Edit handle",
  },
  {
    key: "identity",
    href: "/my-beacon/signal/identity",
    label: "Identity",
    icon: IdCard,
    summary: "Your name, headline, bio, accent color, avatar, and banner.",
    wizardTitle: "Introduce yourself",
    wizardBody:
      "Set your display name, a one-line headline, and a short bio so visitors know who you are. Pick an accent color and add an avatar and banner to make the page yours.",
    cta: "Set up identity",
  },
  {
    key: "layout",
    href: "/my-beacon/signal/layout",
    label: "Layout",
    icon: LayoutPanelTop,
    summary: "Choose a layout and arrange the blocks visitors see.",
    wizardTitle: "Arrange your page",
    wizardBody:
      "Pick a layout and drag your blocks into the order you want. Removing a block here only takes it off the page, it never deletes the underlying boards, leagues, links, or favorites. Build ranking boards under My Rankings first, then feature them here.",
    cta: "Arrange layout",
  },
  {
    key: "showcase",
    href: "/my-beacon/signal/showcase",
    label: "Showcase",
    icon: Star,
    summary: "Links, favorite team and player, and featured Sleeper leagues.",
    wizardTitle: "Show what you are about",
    wizardBody:
      "Add links to your other channels, call out your favorite team and player, and feature any Sleeper leagues you have opened in League Pulse. All optional, all easy to change.",
    cta: "Add showcase items",
  },
  {
    key: "wall",
    href: "/my-beacon/signal/wall",
    label: "Wall",
    icon: MessageSquare,
    summary: "Post short updates that visitors can read and react to.",
    wizardTitle: "Post your first update",
    wizardBody:
      "Your Wall is where you post short updates. Visitors see them newest first, with any pinned post on top, and they can follow you and react. You can edit or delete posts any time.",
    cta: "Open the Wall",
  },
  {
    key: "visibility",
    href: "/my-beacon/signal/visibility",
    label: "Visibility",
    icon: Globe,
    summary: "Publish your profile and choose who can see it.",
    wizardTitle: "Go live",
    wizardBody:
      "Your profile stays private until you publish it. When you are ready, publish it and choose whether anyone on the web can see it or only you. You can switch back to draft at any time.",
    cta: "Publish profile",
  },
] as const;

export function signalSubpageByKey(key: SignalStepKey): SignalSubpage {
  // Non-null: every key in the union has a corresponding registry entry.
  return SIGNAL_SUBPAGES.find((p) => p.key === key)!;
}
