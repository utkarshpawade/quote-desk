import { dec, money, type DecimalString } from "../money";

/**
 * Bringing a past price to today's steel prices (DESIGN.md §5.5). Steel is most of a forged or
 * bar-turned part's price and moves every quarter, so "we quoted ₹118 in 2024" means little
 * until the material difference is taken out.
 */

/** Steel and the scrap it turns into, ₹/kg, on one date. */
export interface RmBasis {
  rmRate: DecimalString;
  scrapRate: DecimalString;
}

export interface RmAdjusted {
  value: DecimalString;
  delta: DecimalString;
  /** True when the scrap side could not be adjusted (net weight unknown). */
  estimated: boolean;
}

/** past price + (RM now − RM then) × gross − (scrap now − scrap then) × (gross − net). */
export function rmAdjustedPrice(args: {
  price: DecimalString;
  grossKg: DecimalString | null;
  netKg: DecimalString | null;
  then: RmBasis | null;
  now: RmBasis | null;
}): RmAdjusted | null {
  const { price, grossKg, netKg, then, now } = args;
  if (!grossKg || !then || !now) return null;
  let delta = dec(now.rmRate).minus(then.rmRate).times(grossKg);
  if (netKg) delta = delta.minus(dec(now.scrapRate).minus(then.scrapRate).times(dec(grossKg).minus(netKg)));
  return { value: money(dec(price).plus(delta)), delta: money(delta), estimated: !netKg };
}

/**
 * What a past price earned over its material, per kg of finished part: (price − material net of
 * scrap at the quote date) / net weight. Same definition as the costing engine's conversionPerKg,
 * so the costing screen can compare like with like.
 */
export function pastConversionPerKg(args: { price: DecimalString; grossKg: DecimalString | null; netKg: DecimalString | null; then: RmBasis | null }): DecimalString | null {
  const { price, grossKg, netKg, then } = args;
  if (!grossKg || !netKg || !then || dec(netKg).lte(0)) return null;
  const netMaterial = dec(grossKg).times(then.rmRate).minus(dec(grossKg).minus(netKg).times(then.scrapRate));
  return money(dec(price).minus(netMaterial).dividedBy(netKg));
}
