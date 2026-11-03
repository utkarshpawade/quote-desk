import Decimal from "decimal.js";

/**
 * Exact decimal arithmetic for all cost maths. Binary floats are never used for money:
 * 0.61 × 72.50 must be 44.225 so that half-up rounding gives 44.23, not 44.22.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

/** A decimal value as it crosses boundaries (DB, JSON, server → client): always a string. */
export type DecimalString = string;

export function dec(value: Decimal.Value): Decimal {
  return new Dec(value);
}

/** Round half-up to the paisa (2 dp). */
export function paise(value: Decimal.Value): Decimal {
  return new Dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Fixed 2-dp string, e.g. "44.23", "-2.52", "0.00". */
export function money(value: Decimal.Value): DecimalString {
  return paise(value).toFixed(2);
}

export function sum(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Dec(0));
}

/** Percent stored as "12.5" → factor 0.125. */
export function pct(value: Decimal.Value): Decimal {
  return new Dec(value).dividedBy(100);
}

/** True when the string is a finite decimal number (optionally signed). */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim());
}
