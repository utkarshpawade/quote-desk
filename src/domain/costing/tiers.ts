import { dec, type DecimalString } from "../money";
import type { TierInput } from "./types";

/**
 * Default quoted volumes (A-6): the RFQ volume exactly, plus ⅔× and 4⁄3× rounded to figures a
 * buyer would write — two significant figures from 10,000 up, the nearest 100 below that.
 * Margins come from the versioned margin ladder (A-23): a smaller order earns more, a larger
 * one less.
 */

export interface MarginLadder {
  basePct: DecimalString;
  /** Added for a tier below the base volume, e.g. "2". */
  belowPp: DecimalString;
  /** Added for a tier above the base volume; negative, e.g. "-1.5". */
  abovePp: DecimalString;
}

export function roundVolume(raw: number): number {
  if (raw >= 10_000) {
    const step = 10 ** (Math.floor(Math.log10(raw)) - 1);
    return Math.round(raw / step) * step;
  }
  return Math.round(raw / 100) * 100;
}

export function marginFor(volume: number, baseVolume: number, ladder: MarginLadder): DecimalString {
  const base = dec(ladder.basePct);
  const margin = volume < baseVolume ? base.plus(ladder.belowPp) : volume > baseVolume ? base.plus(ladder.abovePp) : base;
  return margin.toFixed(3);
}

export function defaultTiers(baseVolume: number, ladder: MarginLadder): TierInput[] {
  if (!Number.isInteger(baseVolume) || baseVolume <= 0) return [];
  const candidates = [roundVolume((baseVolume * 2) / 3), baseVolume, roundVolume((baseVolume * 4) / 3)];
  const volumes = [...new Set(candidates)].filter((v) => v > 0).sort((a, b) => a - b);
  return volumes.map((volume) => ({
    volume,
    isBase: volume === baseVolume,
    marginPct: marginFor(volume, baseVolume, ladder),
  }));
}
