import type { IsoDate } from "../calendar";
import { normalizeGrade } from "../rates/catalog";

/**
 * Parsers that turn what customers write into canonical values, each reporting how much it had
 * to interpret (which lowers confidence). Indian conventions first: 1,80,000 · 1.8 lakh · 1.8 L,
 * DD/MM dates.
 */

export interface Parsed<T> {
  value: T;
  /** What was interpreted, in words ("converted from grams", "15,000/month × 12"). Empty = verbatim. */
  notes: string[];
}

const MULTIPLIER: Array<[RegExp, number, string]> = [
  [/^(crores?|cr)$/i, 1e7, "crore"],
  [/^(lakhs?|lacs?|lac|lakh|l)$/i, 1e5, "lakh"],
  [/^(k|thousand)$/i, 1e3, "thousand"],
];

/** "1,80,000" · "1.8 lakh" · "1.8L" · "18 lakhs" · "180k" · "1.2 crore" · "60000 nos" → integer. */
export function parseIndianNumber(text: string): Parsed<number> | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|k|thousand)?(?![a-z])/i.exec(text.replace(/ /g, " "));
  if (!m) return null;
  const digits = m[1]!.replace(/,/g, "");
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const notes: string[] = [];
  const suffix = m[2];
  if (suffix) {
    const hit = MULTIPLIER.find(([re]) => re.test(suffix));
    if (hit) {
      value *= hit[1];
      notes.push(`${m[1]} ${hit[2]}`);
    }
  }
  return { value: Math.round(value), notes };
}

/** Annualizes per-month or per-week quantities, which Indian RFQs often state as a schedule. */
export function parseAnnualVolume(text: string): Parsed<number> | null {
  const n = parseIndianNumber(text);
  if (!n) return null;
  if (/(per\s*month|\/\s*month|\bp\.?\s*m\.?(?![a-z])|monthly)/i.test(text)) {
    return { value: n.value * 12, notes: [...n.notes, `${n.value.toLocaleString("en-IN")}/month × 12`] };
  }
  if (/(per\s*week|\/\s*week|weekly)/i.test(text)) {
    return { value: n.value * 52, notes: [...n.notes, `${n.value.toLocaleString("en-IN")}/week × 52`] };
  }
  return n;
}

/** "610 g" · "0.61 kg" · "0,61 kg" · "1.48 Kg" · "1480 grams" → kg with 3 decimals. */
export function parseWeightKg(text: string): Parsed<string> | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(kgs?|kilograms?|grams?|gms?|g)(?![a-z])/i.exec(text);
  if (!m) {
    const bare = /(\d+(?:\.\d+)?)/.exec(text);
    if (!bare) return null;
    return { value: Number(bare[1]).toFixed(3), notes: ["no unit given — read as kg"] };
  }
  const unit = m[2]!.toLowerCase();
  let raw = m[1]!;
  const grams = unit.startsWith("g");
  if (!grams && /^\d,\d{1,3}$/.test(raw)) raw = raw.replace(",", "."); // decimal comma: "0,61 kg"
  else raw = raw.replace(/,/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return grams ? { value: (n / 1000).toFixed(3), notes: [`converted from ${m[1]} g`] } : { value: n.toFixed(3), notes: [] };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Dates as written in Indian business mail. Numeric dates are read day-first (A-12); when both
 * parts could be a month the result is flagged so the estimator confirms it.
 */
export function parseDate(text: string): Parsed<IsoDate> | null {
  const t = text.trim();
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) {
    const v = iso(+m[1]!, +m[2]!, +m[3]!);
    return v ? { value: v, notes: [] } : null;
  }
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(t);
  if (m) {
    const d = +m[1]!;
    const mo = +m[2]!;
    const v = iso(+m[3]!, mo, d);
    if (!v) return null;
    const notes = d <= 12 && mo <= 12 && d !== mo ? [`could be ${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")} or ${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")} — read as day/month`] : [];
    return { value: v, notes };
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*([a-z]{3,9})[\s,.-]*(\d{2,4})\b/i.exec(t);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    const v = mo ? iso(+m[3]!, mo, +m[1]!) : null;
    return v ? { value: v, notes: [] } : null;
  }
  m = /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(t);
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    const v = mo ? iso(+m[3]!, mo, +m[2]!) : null;
    return v ? { value: v, notes: [] } : null;
  }
  return null;
}

export interface MaterialOption {
  id: string;
  grade: string;
  aliases: string[];
}

const MATERIAL_NOISE = /\b(as per (drawing|drg|is|din|en)|bright|bar|bars|rod|round|forging|forged|forgings|steel|hot[- ]?rolled|material|grade|matl|spec(ification)?)\b/gi;

/** Matches a customer's material text to a master grade by grade or alias ("EN-8", "080M40" → EN8). */
export function matchMaterial(text: string, materials: MaterialOption[]): { id: string; grade: string; via: "grade" | "alias" } | null {
  const cleaned = text.replace(MATERIAL_NOISE, " ");
  const candidates = [cleaned, ...cleaned.split(/[\s,;/()]+/)].map(normalizeGrade).filter((c) => c.length >= 2);
  for (const c of candidates) {
    const byGrade = materials.find((m) => normalizeGrade(m.grade) === c);
    if (byGrade) return { id: byGrade.id, grade: byGrade.grade, via: "grade" };
  }
  for (const c of candidates) {
    const byAlias = materials.find((m) => m.aliases.some((a) => normalizeGrade(a) === c));
    if (byAlias) return { id: byAlias.id, grade: byAlias.grade, via: "alias" };
  }
  return null;
}

/** The customer, from the sender's email domain. */
export function customerFromEmail<T extends { emailDomain: string | null }>(address: string, customers: T[]): T | null {
  const domain = address.toLowerCase().split("@")[1]?.replace(/[>\s]/g, "");
  return domain ? (customers.find((c) => c.emailDomain && c.emailDomain.toLowerCase() === domain) ?? null) : null;
}
