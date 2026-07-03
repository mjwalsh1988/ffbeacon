/**
 * Shared depth-chart role badge (Starter / Handcuff / Backup / Depth Piece /
 * Dart Throw). One color map so the hero badge and the depth chart card always
 * agree. Role text itself is produced by depthRoleLabel in lib/player-profile.
 */

import { Layers } from "lucide-react";

const ROLE_CLASS: Record<string, string> = {
  Starter: "bg-signal-success/15 text-signal-success",
  Handcuff: "bg-brand-cyan/15 text-brand-cyan",
  Backup: "bg-signal-warning/15 text-signal-warning",
  "Depth Piece": "bg-ink-subtle/15 text-ink-muted",
  "Dart Throw": "bg-brand-purple/15 text-brand-purple",
};

export function roleBadgeClass(role: string): string {
  return ROLE_CLASS[role] ?? "bg-ink-subtle/15 text-ink-muted";
}

export function RoleBadge({ role, className = "" }: { role: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${roleBadgeClass(
        role,
      )} ${className}`}
    >
      <Layers aria-hidden="true" className="h-3.5 w-3.5" />
      {role}
    </span>
  );
}
