import type { CostingResult, LineKey } from "./types";

/** Names as an OEM purchase engineer reads them on a cost breakup. */
export const LINE_LABELS: Record<LineKey, string> = {
  rawMaterial: "Raw material",
  scrapCredit: "Scrap credit",
  netMaterial: "Net material",
  bop: "Bought-out parts",
  inHouseProcess: "In-house processing",
  setup: "Setup (amortized)",
  outsideProcess: "Outside processing",
  conversion: "Conversion",
  rejection: "Rejection allowance",
  overhead: "Overhead",
  icc: "ICC",
  mfgCost: "Manufacturing cost",
  profit: "Profit",
  packing: "Packing",
  freight: "Freight",
  tooling: "Tooling (amortized)",
  unitPrice: "Unit price (ex-GST)",
  annualValue: "Annual value",
  pricePerKg: "Price per kg",
  conversionPerKg: "Conversion per kg",
};

export type Emphasis = "subtotal" | "total";

/** The cost build-up in print order; subtotals and the unit price are emphasised. */
export const BREAKUP_ORDER: ReadonlyArray<{ key: LineKey; emphasis?: Emphasis; hideWhenZero?: boolean }> = [
  { key: "rawMaterial" },
  { key: "scrapCredit" },
  { key: "netMaterial", emphasis: "subtotal" },
  { key: "bop", hideWhenZero: true },
  { key: "inHouseProcess" },
  { key: "setup" },
  { key: "outsideProcess", hideWhenZero: true },
  { key: "conversion", emphasis: "subtotal" },
  { key: "rejection" },
  { key: "overhead" },
  { key: "icc" },
  { key: "mfgCost", emphasis: "subtotal" },
  { key: "profit" },
  { key: "packing" },
  { key: "freight" },
  { key: "tooling", hideWhenZero: true },
  { key: "unitPrice", emphasis: "total" },
];

/** Figures shown under the build-up, not summed into it. */
export const SUMMARY_KEYS: readonly LineKey[] = ["annualValue", "pricePerKg", "conversionPerKg"];

export interface BreakupRow {
  key: LineKey;
  label: string;
  emphasis?: Emphasis;
  /** One value per tier; null where that tier's price is withheld. */
  values: Array<string | null>;
}

/** Breakup rows for display, dropping optional lines that are zero in every tier. */
export function breakupRows(result: CostingResult, keys = BREAKUP_ORDER): BreakupRow[] {
  return keys
    .map(({ key, emphasis }) => ({
      key,
      label: LINE_LABELS[key],
      emphasis,
      values: result.tiers.map((t) => (t.lines ? t.lines[key] : null)),
    }))
    .filter((row) => {
      const spec = keys.find((k) => k.key === row.key);
      if (!spec?.hideWhenZero) return true;
      return row.values.some((v) => v !== null && Number(v) !== 0);
    });
}
