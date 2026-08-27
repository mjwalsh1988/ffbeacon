/**
 * Icon name to icon component, for the navigation rail.
 *
 * The rail's tree is built on the server (lib/nav-tree.ts) and handed to the
 * client already filtered for who is looking, which is what keeps the admin
 * route list out of the bundle a signed-out visitor downloads. A React
 * component is not serialisable across that boundary, so a node carries the
 * name of its icon and the client looks it up here.
 *
 * This map holds no route, no label, and no hint: it is the one part of the
 * navigation that is safe to ship to everyone.
 */

import {
  Home,
  Wrench,
  ListOrdered,
  Gamepad2,
  Newspaper,
  BookOpen,
  Info,
  UserCircle,
  ShieldCheck,
  Workflow,
  Timer,
  Scale,
  Swords,
  Calculator,
  Radar,
  Users,
  Layers,
  Signal,
  Settings,
  BadgeCheck,
  SlidersHorizontal,
  Coins,
  Activity,
  Target,
  MessageCircleQuestion,
  Flag,
  HelpCircle,
  History,
  Radio,
  LayoutDashboard,
  Handshake,
  ArrowLeftRight,
  ListChecks,
  Gauge,
  Trophy,
  GraduationCap,
  BarChart3,
  TrendingDown,
  RefreshCw,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";

export const NAV_ICONS = {
  home: Home,
  wrench: Wrench,
  listOrdered: ListOrdered,
  gamepad: Gamepad2,
  newspaper: Newspaper,
  book: BookOpen,
  info: Info,
  userCircle: UserCircle,
  shield: ShieldCheck,
  workflow: Workflow,
  timer: Timer,
  scale: Scale,
  swords: Swords,
  calculator: Calculator,
  radar: Radar,
  users: Users,
  layers: Layers,
  signal: Signal,
  settings: Settings,
  badgeCheck: BadgeCheck,
  sliders: SlidersHorizontal,
  coins: Coins,
  activity: Activity,
  target: Target,
  question: MessageCircleQuestion,
  flag: Flag,
  help: HelpCircle,
  history: History,
  radio: Radio,
  dashboard: LayoutDashboard,
  handshake: Handshake,
  swap: ArrowLeftRight,
  listChecks: ListChecks,
  gauge: Gauge,
  trophy: Trophy,
  graduationCap: GraduationCap,
  barChart: BarChart3,
  trendingDown: TrendingDown,
  refresh: RefreshCw,
  calendar: CalendarDays,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;

/** The icon for a name, falling back to a neutral glyph rather than crashing. */
export function navIcon(name: NavIconName | string): LucideIcon {
  return NAV_ICONS[name as NavIconName] ?? Info;
}
