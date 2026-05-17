"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const THEMES = ["dark", "light", "system"] as const;
type Theme = (typeof THEMES)[number];

const LABELS: Record<Theme, string> = {
  dark: "Dark theme",
  light: "Light theme",
  system: "Match system theme",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Theme toggle loading"
        className="inline-flex h-9 items-center rounded-card px-3 text-sm text-ink-muted"
        disabled
      >
        Theme
      </button>
    );
  }

  const current = (theme as Theme) ?? "system";

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center gap-1 rounded-card border border-line bg-surface p-1"
    >
      {THEMES.map((option) => {
        const isActive = current === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={LABELS[option]}
            onClick={() => setTheme(option)}
            className={
              "rounded px-2.5 py-1 text-xs font-medium capitalize transition " +
              (isActive
                ? "bg-brand-purple/15 text-ink"
                : "text-ink-muted hover:text-ink")
            }
          >
            {option}
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">
        Theme is {LABELS[current]}
      </span>
    </div>
  );
}
