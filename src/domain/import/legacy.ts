import { dec, isDecimalString } from "../money";
import type { IsoDate } from "../calendar";
import { matchMaterial, parseDate, parseWeightKg, type MaterialOption } from "../intake/normalize";
import { normalizeGrade } from "../rates/catalog";
import { inputForm, shapeFamily, type InputForm, type ShapeFamily } from "../similarity/shape";
import { normalizeText } from "../text";

/**
 * The legacy quote register (A-16): one Excel row per quoted part. Mapping headers, validating
 * rows and binding the routing text to today's work centres are pure functions, so the import
 * screen's dry run and the commit (and the seed) all read a file the same way.
 */

export type LegacyField =
  | "refNo"
  | "quoteDate"
  | "customer"
  | "partNo"
  | "description"
  | "material"
  | "grossWeightKg"
  | "netWeightKg"
  | "annualVolume"
  | "unitPrice"
  | "status"
  | "lostReason"
  | "routing"
  | "estimator";

export const LEGACY_FIELDS: Array<{ field: LegacyField; label: string; required: boolean; synonyms: string[] }> = [
  { field: "refNo", label: "Quote no.", required: true, synonyms: ["quote no", "quotation no", "qtn no", "quote number", "quotation number", "offer no", "ref no"] },
  { field: "quoteDate", label: "Quote date", required: true, synonyms: ["quote date", "quotation date", "qtn date", "offer date", "date"] },
  { field: "customer", label: "Customer", required: true, synonyms: ["customer", "customer name", "client", "party", "oem"] },
  { field: "partNo", label: "Part no.", required: false, synonyms: ["part no", "part number", "item code", "part code"] },
  { field: "description", label: "Description", required: true, synonyms: ["part description", "description", "part name", "component"] },
  { field: "material", label: "Material", required: false, synonyms: ["material", "grade", "matl", "material grade", "raw material"] },
  { field: "grossWeightKg", label: "Gross weight", required: false, synonyms: ["gross wt", "gross weight", "input wt", "input weight"] },
  { field: "netWeightKg", label: "Net weight", required: false, synonyms: ["net wt", "net weight", "finish wt", "finished weight"] },
  { field: "annualVolume", label: "Annual qty", required: false, synonyms: ["annual qty", "annual quantity", "eau", "annual volume", "qty per annum", "annual requirement"] },
  { field: "unitPrice", label: "Unit price", required: true, synonyms: ["unit price", "price", "quoted price", "unit rate", "rate", "price per piece"] },
  { field: "status", label: "Status", required: true, synonyms: ["status", "result", "outcome"] },
  { field: "lostReason", label: "Lost reason", required: false, synonyms: ["lost reason", "loss reason", "reason", "remarks"] },
  { field: "routing", label: "Routing", required: false, synonyms: ["routing", "process route", "operations", "process"] },
  { field: "estimator", label: "Estimator", required: false, synonyms: ["estimator", "prepared by", "costed by"] },
];

const clean = (header: string) => normalizeText(header.replace(/\(.*?\)/g, " "));

export interface LegacyColumn {
  field: LegacyField;
  header: string;
  col: number;
}

/** Maps a header row: exact synonyms first, then prefixes; each field takes its first column. */
export function mapLegacyHeader(headers: Array<{ text: string; col: number }>): { mapped: LegacyColumn[]; unmapped: string[]; missing: LegacyField[] } {
  const mapped: LegacyColumn[] = [];
  const taken = new Set<number>();
  for (const pass of ["exact", "prefix"] as const) {
    for (const spec of LEGACY_FIELDS) {
      if (mapped.some((m) => m.field === spec.field)) continue;
      const hit = headers.find(
        (h) => !taken.has(h.col) && spec.synonyms.some((s) => (pass === "exact" ? clean(h.text) === s : clean(h.text).startsWith(`${s} `))),
      );
      if (hit) {
        mapped.push({ field: spec.field, header: hit.text, col: hit.col });
        taken.add(hit.col);
      }
    }
  }
  return {
    mapped: mapped.sort((a, b) => a.col - b.col),
    unmapped: headers.filter((h) => !taken.has(h.col)).map((h) => h.text),
    missing: LEGACY_FIELDS.filter((f) => f.required && !mapped.some((m) => m.field === f.field)).map((f) => f.field),
  };
}

// ─── routing ──────────────────────────────────────────────────────────────────

export type OperationKind = "MACHINE" | "PROCESS_KG" | "PROCESS_PC";

/** A current work centre and the names it was known by in the old register. */
export interface WorkCentre {
  itemId: string;
  name: string;
  kind: OperationKind;
  names: string[];
  weightBasis: "GROSS" | "FORGED" | "NET" | null;
}

/** One operation of a past routing, stored as JSON on the past quote. */
export interface PastRoutingOp {
  name: string;
  /** The current work centre it maps to; null when the legacy name is unknown. */
  itemId: string | null;
  kind: OperationKind;
  cycleTimeMin: string | null;
  setupMin: string | null;
  weightBasis: "GROSS" | "FORGED" | "NET" | null;
  /** As written in the register. */
  legacyName?: string | null;
}

const opKey = (s: string) => normalizeGrade(s);

/**
 * "Bar cutting 0.4 | Upset forging | LT-25 6.5" → three operations. A trailing number is the
 * cycle time in minutes (machines only); names bind to work centres through their aliases.
 */
export function parseRouting(text: string, centres: WorkCentre[]): PastRoutingOp[] {
  return text
    .split(/\s*(?:\||;|→|->|\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((part) => {
      const m = /^(.*?)(?:\s+(\d+(?:\.\d+)?)\s*(?:min|mins)?)?$/i.exec(part)!;
      const legacy = (m[1] || part).trim();
      const centre = centres.find((c) => c.names.some((n) => opKey(n) === opKey(legacy)));
      const cycle = m[2] && centre?.kind !== "PROCESS_KG" && centre?.kind !== "PROCESS_PC" ? Number(m[2]).toFixed(2) : null;
      return {
        name: centre?.name ?? legacy,
        itemId: centre?.itemId ?? null,
        kind: centre?.kind ?? (cycle ? "MACHINE" : "PROCESS_PC"),
        cycleTimeMin: cycle,
        setupMin: null,
        weightBasis: centre?.weightBasis ?? null,
        legacyName: legacy,
      };
    });
}

// ─── rows ─────────────────────────────────────────────────────────────────────

export type Outcome = "WON" | "LOST" | "NO_RESPONSE" | "OPEN" | "REGRETTED";

const OUTCOMES: Array<[Outcome, RegExp]> = [
  ["WON", /^(won|win|order (received|won)|po (received|placed)|awarded)$/],
  ["LOST", /^(lost|loss|not (awarded|won))$/],
  ["NO_RESPONSE", /^(no (response|reply|feedback)|nr|awaited)$/],
  ["REGRETTED", /^(regret(ted)?|declined|not quoted)$/],
  ["OPEN", /^(open|pending|under (discussion|negotiation))$/],
];

export function parseOutcome(text: string): Outcome | null {
  const t = normalizeText(text);
  return OUTCOMES.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** A cell as the reader gives it: typed value plus the text Excel shows. */
export interface LegacyCell {
  value: string | number | boolean | Date | null;
  text: string;
  address: string;
}

export interface RowIssue {
  row: number;
  /** Cell address ("J10") or null for whole-row problems. */
  cell: string | null;
  severity: "error" | "warning";
  message: string;
}

export interface LegacyRecord {
  row: number;
  refNo: string;
  quoteDate: IsoDate;
  customerName: string;
  partNo: string;
  description: string;
  materialText: string | null;
  materialItemId: string | null;
  grossWeightKg: string | null;
  netWeightKg: string | null;
  annualVolume: number | null;
  unitPrice: string;
  outcome: Outcome;
  lostReason: string | null;
  estimatorName: string | null;
  routingText: string | null;
  routingOps: PastRoutingOp[];
  inputForm: InputForm;
  shapeFamily: ShapeFamily;
  searchText: string;
}

export interface RowContext {
  materials: MaterialOption[];
  centres: WorkCentre[];
  today: IsoDate;
}

/** Excel dates come back as instants near midnight in some zone; the nearest day is the date. */
function excelDate(d: Date): IsoDate {
  return new Date(d.getTime() + 12 * 3_600_000).toISOString().slice(0, 10) as IsoDate;
}

function plainNumber(cell: LegacyCell): number | null {
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return cell.value;
  const t = cell.text.replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/,/g, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

function weight(cell: LegacyCell | undefined): { value: string | null; problem: string | null } {
  if (!cell) return { value: null, problem: null };
  const n = typeof cell.value === "number" ? cell.value : null;
  const kg = n !== null ? n.toFixed(3) : parseWeightKg(/[a-z]/i.test(cell.text) ? cell.text : `${cell.text} kg`)?.value ?? null;
  if (kg === null || !isDecimalString(kg)) return { value: null, problem: `“${cell.text}” is not a weight` };
  if (dec(kg).lte(0) || dec(kg).gt(500)) return { value: null, problem: `${cell.text} kg is outside 0–500 kg` };
  return { value: kg, problem: null };
}

/**
 * Validates one register row. Errors keep the row out (the report says why); warnings import it
 * without the doubtful value.
 */
export function readLegacyRow(
  rowNumber: number,
  cells: Partial<Record<LegacyField, LegacyCell>>,
  ctx: RowContext,
): { record: LegacyRecord | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const error = (cell: LegacyCell | undefined, message: string) => issues.push({ row: rowNumber, cell: cell?.address ?? null, severity: "error", message });
  const warn = (cell: LegacyCell | undefined, message: string) => issues.push({ row: rowNumber, cell: cell?.address ?? null, severity: "warning", message });
  const text = (f: LegacyField) => cells[f]?.text.trim() || null;

  const refNo = text("refNo");
  if (!refNo) error(undefined, "Quote no. is empty");
  const customerName = text("customer");
  if (!customerName) error(undefined, "Customer is empty");
  const description = text("description");
  if (!description) error(undefined, "Part description is empty");

  // Date
  let quoteDate: IsoDate | null = null;
  const dateCell = cells.quoteDate;
  if (!dateCell) error(undefined, "Quote date is empty");
  else {
    quoteDate = dateCell.value instanceof Date ? excelDate(dateCell.value) : (parseDate(dateCell.text)?.value ?? null);
    if (!quoteDate) error(dateCell, `“${dateCell.text}” is not a valid date`);
    else if (quoteDate > ctx.today) error(dateCell, `Quote date ${dateCell.text} is in the future`);
    else if (quoteDate < "2000-01-01") error(dateCell, `Quote date ${dateCell.text} is before 2000`);
  }

  // Price
  let unitPrice: string | null = null;
  const priceCell = cells.unitPrice;
  if (!priceCell) error(undefined, "Unit price is empty");
  else {
    const n = plainNumber(priceCell);
    if (n === null) error(priceCell, `Unit price “${priceCell.text}” is not a number`);
    else if (n <= 0) error(priceCell, `Unit price ${priceCell.text} must be more than zero`);
    else if (n > 1_000_000) error(priceCell, `Unit price ${priceCell.text} is implausibly high`);
    else unitPrice = n.toFixed(2);
  }

  // Outcome
  let outcome: Outcome | null = null;
  const statusCell = cells.status;
  if (!statusCell) error(undefined, "Status is empty");
  else {
    outcome = parseOutcome(statusCell.text);
    if (!outcome) error(statusCell, `Status “${statusCell.text}” is not Won, Lost, No response, Regret or Open`);
  }

  // Weights
  const gross = weight(cells.grossWeightKg);
  const net = weight(cells.netWeightKg);
  if (gross.problem) warn(cells.grossWeightKg, `Gross weight ${gross.problem} — imported without it`);
  if (net.problem) warn(cells.netWeightKg, `Net weight ${net.problem} — imported without it`);
  if (gross.value && net.value && dec(net.value).gt(gross.value)) {
    error(cells.netWeightKg, `Net weight ${Number(net.value)} kg is more than gross ${Number(gross.value)} kg`);
  }

  // Volume
  let annualVolume: number | null = null;
  const volumeCell = cells.annualVolume;
  if (volumeCell) {
    const n = plainNumber(volumeCell);
    if (n === null || n < 0 || n > 100_000_000) warn(volumeCell, `Annual qty “${volumeCell.text}” is not a number — imported without it`);
    else annualVolume = Math.round(n);
  }

  // Material
  const materialText = text("material");
  const material = materialText ? matchMaterial(materialText, ctx.materials) : null;
  if (materialText && !material) warn(cells.material, `Material “${materialText}” is not in the rate master — kept as text, no RM-adjusted price`);

  const routingText = text("routing");
  const routingOps = routingText ? parseRouting(routingText, ctx.centres) : [];

  if (issues.some((i) => i.severity === "error") || !refNo || !customerName || !description || !quoteDate || !unitPrice || !outcome) {
    return { record: null, issues };
  }

  const partNo = text("partNo") ?? "";
  const forgedRoute = routingOps.some((op) => /forg/i.test(`${op.name} ${op.legacyName ?? ""}`));
  return {
    record: {
      row: rowNumber,
      refNo,
      quoteDate,
      customerName,
      partNo,
      description,
      materialText,
      materialItemId: material?.id ?? null,
      grossWeightKg: gross.value,
      netWeightKg: net.value,
      annualVolume,
      unitPrice,
      outcome,
      lostReason: outcome === "LOST" ? text("lostReason") : null,
      estimatorName: text("estimator"),
      routingText,
      routingOps,
      inputForm: inputForm({ materialText, description, hasForgedWeight: forgedRoute }),
      shapeFamily: shapeFamily(description),
      searchText: [partNo, description, materialText, customerName].filter(Boolean).join(" · ").toLowerCase(),
    },
    issues,
  };
}

/** Identity of a past quote row: the same quote can list several parts. */
export const recordKey = (r: { refNo: string; partNo: string }) => `${r.refNo.trim().toUpperCase()}|${r.partNo.trim().toUpperCase()}`;
