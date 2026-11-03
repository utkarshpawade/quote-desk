/**
 * Document numbers.
 * - RFQ register numbers follow the client's pattern RFQ-YYMM-NNN (A-17), e.g. RFQ-2611-014:
 *   year 26, month 11, 14th RFQ of the month. The sequence is allocated atomically in the DB.
 * - Quote numbers derive from the RFQ: QT-2611-014-R0, with the revision number appended.
 */

const RFQ_PATTERN = /^RFQ-(\d{2})(\d{2})-(\d{3,})$/;

/** "2611" for an India calendar date in November 2026 (see `toIstDate`). */
export function periodKey(istDate: string): string {
  const m = /^\d{2}(\d{2})-(\d{2})-\d{2}$/.exec(istDate);
  if (!m) throw new Error(`Invalid date "${istDate}"`);
  return `${m[1]}${m[2]}`;
}

export function formatRfqNumber(period: string, sequence: number): string {
  if (!/^\d{4}$/.test(period)) throw new Error(`Invalid period "${period}"`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Invalid sequence ${sequence}`);
  return `RFQ-${period}-${String(sequence).padStart(3, "0")}`;
}

export function parseRfqNumber(rfqNumber: string): { period: string; sequence: number } | null {
  const m = RFQ_PATTERN.exec(rfqNumber);
  if (!m) return null;
  return { period: `${m[1]}${m[2]}`, sequence: Number(m[3]) };
}

export function formatQuoteNumber(rfqNumber: string, revision: number): string {
  const parsed = parseRfqNumber(rfqNumber);
  if (!parsed) throw new Error(`Invalid RFQ number "${rfqNumber}"`);
  if (!Number.isInteger(revision) || revision < 0) throw new Error(`Invalid revision ${revision}`);
  return `QT-${rfqNumber.slice("RFQ-".length)}-R${revision}`;
}
