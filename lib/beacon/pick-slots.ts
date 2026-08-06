/**
 * Draft slot vocabulary shared by the manual-signal admin UI, the server action
 * that writes signals, and the value engine that reads them. KTC publishes pick
 * values in these three buckets, so a manual pick signal addresses the same
 * three, or all of them at once.
 */

export const PICK_SLOTS = ["early", "mid", "late"] as const;
export type PickSlot = (typeof PICK_SLOTS)[number];

export function isPickSlot(value: string): value is PickSlot {
  return (PICK_SLOTS as readonly string[]).includes(value);
}

/**
 * Plain-language description of the slots a pick signal covers, for a label or
 * an announcement. A signal with no slot named covers every slot.
 */
export function describePickSlots(slot: string | null): string {
  return slot === null ? "all slots" : `${slot} slot`;
}

/** Full subject line for a pick signal, e.g. "2027 round 3 picks, early slot". */
export function describePickSignal(
  season: number | null,
  round: number | null,
  slot: string | null,
): string {
  const year = season ?? "unknown season";
  const rd = round === null ? "unknown round" : `round ${round}`;
  return `${year} ${rd} picks, ${describePickSlots(slot)}`;
}
