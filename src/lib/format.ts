/**
 * Display formatting shared by the UI and the PDF. Indian conventions throughout:
 * lakh/crore digit grouping (1,23,456.00), compact values in lakh (L) and crore (Cr),
 * and day-month-year dates.
 *
 * Decimal values travel as strings; Intl formats numeric strings exactly, so no float
 * rounding creeps in between the costing engine and the screen.
 */

type Numeric = string | number;

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const rupeesWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const numberFormats = new Map<string, Intl.NumberFormat>();

function toIntlInput(value: Numeric): number | `${number}` {
  return (typeof value === "number" ? value : value.trim()) as number | `${number}`;
}

/** ₹1,23,456.78 */
export function formatINR(value: Numeric): string {
  return rupees.format(toIntlInput(value));
}

/** ₹1,23,457 (no paise) */
export function formatINRWhole(value: Numeric): string {
  return rupeesWhole.format(toIntlInput(value));
}

/** 1,23,456.78 with a fixed number of decimals, no currency sign. */
export function formatNumber(value: Numeric, decimals = 2): string {
  const key = `${decimals}`;
  let fmt = numberFormats.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(key, fmt);
  }
  return fmt.format(toIntlInput(value));
}

/** Whole numbers such as volumes: 1,80,000 */
export function formatInteger(value: Numeric): string {
  return formatNumber(value, 0);
}

const LAKH = 1e5;
const CRORE = 1e7;

/**
 * Compact rupees for summaries: ₹2.21 Cr, ₹25.00 L, ₹84,500.
 * Two decimals keep the ₹25 lakh approval boundary unambiguous (₹25.00 L vs ₹25.01 L).
 */
export function formatINRCompact(value: Numeric): string {
  const n = typeof value === "number" ? value : Number(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= CRORE) return `${sign}₹${(abs / CRORE).toFixed(2)} Cr`;
  if (abs >= LAKH) return `${sign}₹${(abs / LAKH).toFixed(2)} L`;
  return `${sign}${formatINRWhole(abs)}`;
}

/** 12% / 12.5% / 1.25% — trailing zeros trimmed, up to 3 decimals. */
export function formatPercent(value: Numeric): string {
  const n = typeof value === "number" ? value : Number(value);
  return `${Number(n.toFixed(3))}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** 03 Nov 2026 (India time) */
export function formatDate(value: Date | string): string {
  return dateFmt.format(toDate(value));
}

/** 03 Nov 2026, 14:05 (India time) */
export function formatDateTime(value: Date | string): string {
  return dateTimeFmt.format(toDate(value));
}
