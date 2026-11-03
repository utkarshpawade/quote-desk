import type { Prisma } from "@/generated/prisma/client";
import { fromDbDate } from "@/domain/calendar";

/**
 * The one place database values become transfer values. Prisma bundles its own decimal.js, so
 * Prisma.Decimal never leaves the server layer: it is formatted at the column's scale as a
 * string here, and domain code re-parses it with src/domain/money.ts.
 */

type Dec = Prisma.Decimal;

function fixed(value: Dec | null | undefined, scale: number): string | null {
  return value === null || value === undefined ? null : value.toFixed(scale);
}

/** numeric(14,4) rate values: "72.5000" */
export const rateStr = (v: Dec | null | undefined) => fixed(v, 4);
/** numeric(14,2) / (16,2) money: "122.61" */
export const moneyStr = (v: Dec | null | undefined) => fixed(v, 2);
/** numeric(10,3) weights and quantities: "0.610" */
export const kgStr = (v: Dec | null | undefined) => fixed(v, 3);
/** numeric(6,3) percentages: "12.000" */
export const pctStr = (v: Dec | null | undefined) => fixed(v, 3);
/** numeric(8,3) minutes: "3.200" */
export const minStr = (v: Dec | null | undefined) => fixed(v, 3);

/** DATE column → "YYYY-MM-DD" (never shifted by the server's time zone). */
export function dateStr(value: Date): string;
export function dateStr(value: Date | null | undefined): string | null;
export function dateStr(value: Date | null | undefined): string | null {
  return value ? fromDbDate(value) : null;
}

/** Timestamp → ISO string (formatted for display with an explicit IST zone by src/lib/format). */
export function isoStr(value: Date): string;
export function isoStr(value: Date | null | undefined): string | null;
export function isoStr(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
