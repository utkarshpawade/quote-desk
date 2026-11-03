import { normalizeText } from "../text";

/**
 * Part-list column headers as customers write them. Parsing a sheet needs no AI: the header row
 * is found by how many headers it recognises, and every value keeps its cell address.
 */
const SYNONYMS: Array<[field: string, headers: string[]]> = [
  ["partNo", ["part no", "part number", "part #", "item code", "item no", "part code", "drg no part no"]],
  ["description", ["description", "part name", "part description", "name", "component", "item description"]],
  ["material", ["material", "matl", "grade", "material grade", "raw material"]],
  ["grossWeightKg", ["gross wt", "gross weight", "input wt", "input weight", "gross wt kg", "forging wt", "cut wt"]],
  ["netWeightKg", ["net wt", "net weight", "finish wt", "finished weight", "finish weight", "net wt kg"]],
  ["annualVolume", ["annual qty", "annual quantity", "eau", "annual volume", "qty per annum", "volume", "annual requirement", "yearly qty"]],
  ["monthlyVolume", ["monthly qty", "monthly volume", "qty per month", "monthly requirement", "monthly schedule"]],
  ["drawingNo", ["drawing no", "drg no", "drawing number", "dwg no"]],
  ["drawingRev", ["rev", "revision", "drg rev", "rev no"]],
];

export interface ColumnMapping {
  field: string;
  header: string;
  col: number;
}

function clean(header: string): string {
  return normalizeText(header.replace(/\(.*?\)/g, " "));
}

export function mapHeader(header: string): string | null {
  const h = clean(header);
  for (const [field, names] of SYNONYMS) if (names.some((n) => h === n)) return field;
  for (const [field, names] of SYNONYMS) if (names.some((n) => h.startsWith(n) || (n.length > 4 && h.includes(n)))) return field;
  return null;
}

/** Maps a header row; a field is taken by its first matching column only. */
export function mapColumns(headers: Array<{ text: string; col: number }>): { mapped: ColumnMapping[]; unmapped: string[] } {
  const mapped: ColumnMapping[] = [];
  const unmapped: string[] = [];
  for (const h of headers) {
    const field = mapHeader(h.text);
    if (field && !mapped.some((m) => m.field === field)) mapped.push({ field, header: h.text, col: h.col });
    else unmapped.push(h.text);
  }
  return { mapped, unmapped };
}
