/**
 * Re-export shim. The chart furniture that used to live in this file moved to
 * components/chart-kit.tsx (see that file's header for why): League Pulse's
 * Positional WAR chart needed the same ChartFigure accessibility contract, and
 * importing across an app route boundary is the wrong dependency direction.
 * This file exists only so the four tabs in this tool that import from
 * "./chart-kit" keep working unchanged.
 */

export * from "@/components/chart-kit";
