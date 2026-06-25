/**
 * Signal Check verdict (Beacon Verdict).
 *
 * Margin formula (exactly as specified):
 *   margin = abs(final_A - final_B) / (final_A + final_B)
 * expressed as a percent. The neutral threshold is applied to the UNROUNDED
 * margin so display rounding cannot flip a near-even call. A margin strictly
 * below the threshold returns the neutral label with no winner.
 */

import type { BeaconVerdict, SideKey, SignalCheckSettings } from "./types";
import { renderTemplate } from "./template";

export function computeVerdict(
  totalA: number,
  totalB: number,
  settings: SignalCheckSettings,
): BeaconVerdict {
  const sum = totalA + totalB;
  const precision = Math.max(0, Math.floor(settings.marginPrecision));

  if (sum <= 0) {
    return {
      label: settings.neutralLabel,
      winnerSide: null,
      marginPct: 0,
      marginRaw: 0,
      isNeutral: true,
      isBlowout: false,
    };
  }

  const marginRaw = (Math.abs(totalA - totalB) / sum) * 100;
  const marginPct = Number(marginRaw.toFixed(precision));
  const rawWinner: SideKey | null = totalA > totalB ? "a" : totalB > totalA ? "b" : null;
  const isNeutral = marginRaw < settings.neutralThresholdPct || rawWinner === null;
  const isBlowout = !isNeutral && marginRaw >= settings.blowoutThresholdPct;

  if (isNeutral) {
    return {
      label: settings.neutralLabel,
      winnerSide: null,
      marginPct,
      marginRaw,
      isNeutral: true,
      isBlowout: false,
    };
  }

  const winnerSide = rawWinner as SideKey;
  const label = renderTemplate(settings.winTemplate, {
    side: winnerSide.toUpperCase(),
    margin: marginPct,
  });

  return { label, winnerSide, marginPct, marginRaw, isNeutral: false, isBlowout };
}
