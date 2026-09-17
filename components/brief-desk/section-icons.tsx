/**
 * The fixed section icon set (lib/brief-desk/blocks.ts SECTION_ICONS) mapped
 * to lucide icons, the same way the guides index maps its Guide.icon. A
 * section or a callout names one by its string; the icon is decorative and
 * the heading beside it carries the meaning.
 */

import {
  Activity,
  ArrowLeftRight,
  Calendar,
  CircleHelp,
  FileSignature,
  Layers,
  ListPlus,
  Scale,
  TrendingUp,
  Trophy,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { isSectionIcon, type SectionIcon } from "@/lib/brief-desk/blocks";

export const SECTION_ICON_MAP: Record<SectionIcon, LucideIcon> = {
  injury: Activity,
  transaction: ArrowLeftRight,
  contract: FileSignature,
  "depth-chart": Layers,
  coaching: Workflow,
  scoreboard: Trophy,
  values: TrendingUp,
  waiver: ListPlus,
  trade: Scale,
  draft: Users,
  calendar: Calendar,
  faq: CircleHelp,
};

/** The icon for a section's string, or null when the string is not in the set. */
export function sectionIcon(name: string | null | undefined): LucideIcon | null {
  return isSectionIcon(name) ? SECTION_ICON_MAP[name] : null;
}
