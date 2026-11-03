import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { todayIst, toDbDate, type IsoDate } from "@/domain/calendar";
import {
  LEGACY_FIELDS,
  mapLegacyHeader,
  readLegacyRow,
  recordKey,
  type LegacyCell,
  type LegacyColumn,
  type LegacyField,
  type LegacyRecord,
  type RowIssue,
  type WorkCentre,
} from "@/domain/import/legacy";
import type { MaterialOption } from "@/domain/intake/normalize";
import { MachineAttributes, MaterialAttributes, ProcessAttributes } from "@/domain/rates/catalog";
import { normalizeText } from "@/domain/text";
import type { Db, DbOrTx } from "@/server/db-client";
import { isoStr } from "@/server/dto";
import { UserError } from "@/server/errors";
import { columnLetter, readSpreadsheet, SpreadsheetError, type SheetData } from "@/server/files/spreadsheet";
import { recordAudit } from "./audit";
import { Catalog } from "./rates";

/**
 * Past-quote import from the legacy Excel register. Two steps over the same reader: a dry run
 * that reports what would happen row by row, and the import itself, which re-reads the file
 * (the browser's preview is never trusted). Idempotent: a row is identified by quote no. + part
 * no., so importing a file twice — or a corrected copy — only adds what is new.
 */

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 5_000;
const MAX_ISSUES = 300;

/** Sample files reviewers can import in one click (they ship with the app). */
export const SAMPLE_IMPORTS = {
  register: { file: "past-quotes-2023-2026.xlsx", label: "Quote register 2023–26 (1,400 rows)" },
  errors: { file: "past-quotes-with-errors.xlsx", label: "Register extract with 7 deliberate mistakes (60 rows)" },
} as const;
export type SampleImport = keyof typeof SAMPLE_IMPORTS;

export async function readSampleImport(key: SampleImport): Promise<{ bytes: Uint8Array; filename: string }> {
  const { file } = SAMPLE_IMPORTS[key];
  // The folder is a literal so the deployment bundles sample-data only, not the whole project.
  return { bytes: new Uint8Array(await readFile(path.join(process.cwd(), "sample-data", file))), filename: file };
}

export interface ImportColumn {
  field: LegacyField;
  label: string;
  required: boolean;
  header: string | null;
  letter: string | null;
}

export interface ImportAnalysis {
  filename: string;
  sha256: string;
  /** The same file (by content) was imported before. */
  sameFile: { at: string; by: string } | null;
  sheet: string;
  headerRow: number;
  columns: ImportColumn[];
  unmapped: string[];
  counts: { rows: number; ready: number; existing: number; duplicates: number; failed: number; warnings: number };
  issues: RowIssue[];
  issuesTruncated: boolean;
  preview: Array<Pick<LegacyRecord, "row" | "refNo" | "quoteDate" | "customerName" | "partNo" | "description" | "materialText" | "unitPrice" | "outcome">>;
}

export function materialOptions(catalog: Catalog): MaterialOption[] {
  return catalog.ofCategory("MATERIAL", true).map((i) => {
    const a = MaterialAttributes.safeParse(i.attributes);
    return { id: i.id, grade: a.success ? a.data.grade : i.code, aliases: a.success ? a.data.aliases : [] };
  });
}

/** Machines and processes with every name the old register used for them. */
export function workCentres(catalog: Catalog): WorkCentre[] {
  const centres: WorkCentre[] = [];
  for (const item of catalog.ofCategory("MACHINE")) {
    const a = MachineAttributes.safeParse(item.attributes);
    centres.push({ itemId: item.id, name: item.name, kind: "MACHINE", names: [item.name, item.code, ...(a.success ? a.data.aliases : [])], weightBasis: null });
  }
  for (const item of catalog.ofCategory("PROCESS")) {
    const a = ProcessAttributes.safeParse(item.attributes);
    const perKg = item.unit === "PER_KG";
    centres.push({
      itemId: item.id,
      name: item.name,
      kind: perKg ? "PROCESS_KG" : "PROCESS_PC",
      names: [item.name, item.code, ...(a.success ? a.data.aliases : [])],
      weightBasis: perKg ? ((a.success ? a.data.defaultWeightBasis : undefined) ?? "GROSS") : null,
    });
  }
  return centres;
}

function findHeader(sheets: SheetData[]): { sheet: SheetData; index: number; mapped: LegacyColumn[]; unmapped: string[] } {
  let best: { sheet: SheetData; index: number; mapped: LegacyColumn[]; unmapped: string[]; missing: LegacyField[] } | null = null;
  for (const sheet of sheets) {
    for (let r = 0; r < Math.min(10, sheet.rows.length); r++) {
      const headers = sheet.rows[r]!.filter((c) => typeof c.value === "string").map((c) => ({ text: c.text, col: c.col }));
      const { mapped, unmapped, missing } = mapLegacyHeader(headers);
      if (missing.length === 0) return { sheet, index: r, mapped, unmapped };
      if (!best || mapped.length > best.mapped.length) best = { sheet, index: r, mapped, unmapped, missing };
    }
  }
  if (best && best.mapped.length >= 3) {
    const labels = best.missing.map((f) => LEGACY_FIELDS.find((s) => s.field === f)!.label).join(", ");
    throw new UserError(`The register is missing required columns: ${labels}. Found: ${best.mapped.map((m) => m.header).join(", ")}.`);
  }
  throw new UserError("No quote-register header row found. The first rows should name columns like Quote No, Quote Date, Customer, Part Description, Unit Price and Status.");
}

async function analyze(db: DbOrTx, bytes: Uint8Array, filename: string, today: IsoDate): Promise<{ analysis: ImportAnalysis; ready: LegacyRecord[] }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let sheets: SheetData[];
  try {
    ({ sheets } = readSpreadsheet(bytes, filename, { maxRows: MAX_ROWS }));
  } catch (error) {
    if (error instanceof SpreadsheetError) throw new UserError(error.message);
    throw error;
  }
  const { sheet, index, mapped, unmapped } = findHeader(sheets);

  const catalog = await Catalog.load(db);
  const ctx = { materials: materialOptions(catalog), centres: workCentres(catalog), today };

  const issues: RowIssue[] = [];
  const records: LegacyRecord[] = [];
  const firstRow = new Map<string, number>();
  let rows = 0;
  let failed = 0;
  let duplicates = 0;
  for (const row of sheet.rows.slice(index + 1)) {
    const cells: Partial<Record<LegacyField, LegacyCell>> = {};
    for (const m of mapped) {
      const cell = row.find((c) => c.col === m.col);
      if (cell) cells[m.field] = { value: cell.value, text: cell.text, address: cell.address };
    }
    if (Object.keys(cells).length === 0) continue;
    rows++;
    const rowNumber = row[0]!.row;
    const { record, issues: rowIssues } = readLegacyRow(rowNumber, cells, ctx);
    issues.push(...rowIssues);
    if (!record) {
      failed++;
      continue;
    }
    const key = recordKey(record);
    const first = firstRow.get(key);
    if (first !== undefined) {
      duplicates++;
      issues.push({ row: rowNumber, cell: null, severity: "warning", message: `Same quote no. and part no. as row ${first} — skipped` });
      continue;
    }
    firstRow.set(key, rowNumber);
    records.push(record);
  }
  if (rows === 0) throw new UserError("The register has a header row but no data rows.");

  // Rows already in the database (from an earlier import of this or another file).
  const existing = new Set(
    (
      await db.pastQuote.findMany({
        where: { source: "LEGACY_IMPORT", refNo: { in: [...new Set(records.map((r) => r.refNo))] } },
        select: { refNo: true, partNo: true },
      })
    ).map(recordKey),
  );
  const ready = records.filter((r) => !existing.has(recordKey(r)));

  const previous = await db.importBatch.findFirst({ where: { fileSha256: sha256 }, orderBy: { createdAt: "desc" }, select: { createdAt: true, createdBy: { select: { name: true } } } });
  const sorted = issues.sort((a, b) => a.row - b.row || (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));

  return {
    ready,
    analysis: {
      filename,
      sha256,
      sameFile: previous ? { at: isoStr(previous.createdAt), by: previous.createdBy.name } : null,
      sheet: sheet.name,
      headerRow: sheet.rows[index]![0]?.row ?? index + 1,
      columns: LEGACY_FIELDS.map((f) => {
        const m = mapped.find((x) => x.field === f.field);
        return { field: f.field, label: f.label, required: f.required, header: m?.header ?? null, letter: m ? columnLetter(m.col) : null };
      }),
      unmapped,
      counts: {
        rows,
        ready: ready.length,
        existing: records.length - ready.length,
        duplicates,
        failed,
        warnings: issues.filter((i) => i.severity === "warning").length,
      },
      issues: sorted.slice(0, MAX_ISSUES),
      issuesTruncated: sorted.length > MAX_ISSUES,
      preview: ready.slice(0, 8).map((r) => ({
        row: r.row,
        refNo: r.refNo,
        quoteDate: r.quoteDate,
        customerName: r.customerName,
        partNo: r.partNo,
        description: r.description,
        materialText: r.materialText,
        unitPrice: r.unitPrice,
        outcome: r.outcome,
      })),
    },
  };
}

/** Dry run: what importing this file would do. Writes nothing. */
export async function analyzePastQuotes(db: DbOrTx, file: { bytes: Uint8Array; filename: string }): Promise<ImportAnalysis> {
  return (await analyze(db, file.bytes, file.filename, todayIst())).analysis;
}

export interface ImportResult {
  batchId: string;
  imported: number;
  skipped: number;
  failed: number;
}

export async function importPastQuotes(
  db: Db,
  user: { id: string; name: string },
  file: { bytes: Uint8Array; filename: string },
  options: { now?: Date } = {},
): Promise<ImportResult> {
  const now = options.now ?? new Date();
  const { analysis, ready } = await analyze(db, file.bytes, file.filename, todayIst(now));
  const customers = await db.customer.findMany({ select: { id: true, name: true } });
  const customerId = new Map(customers.map((c) => [normalizeText(c.name), c.id]));

  return db.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          filename: file.filename,
          fileSha256: analysis.sha256,
          rowsTotal: analysis.counts.rows,
          rowsImported: 0,
          rowsSkipped: 0,
          rowsFailed: analysis.counts.failed,
          issues: analysis.issues as object[],
          createdById: user.id,
          createdAt: now,
        },
      });
      // skipDuplicates: a concurrent import of the same rows cannot create doubles (unique key).
      const { count } = await tx.pastQuote.createMany({
        skipDuplicates: true,
        data: ready.map((r) => ({
          source: "LEGACY_IMPORT" as const,
          refNo: r.refNo,
          quoteDate: toDbDate(r.quoteDate),
          customerName: r.customerName,
          customerId: customerId.get(normalizeText(r.customerName)) ?? null,
          partNo: r.partNo,
          description: r.description,
          materialText: r.materialText,
          materialItemId: r.materialItemId,
          inputForm: r.inputForm,
          shapeFamily: r.shapeFamily,
          grossWeightKg: r.grossWeightKg,
          netWeightKg: r.netWeightKg,
          annualVolume: r.annualVolume,
          unitPrice: r.unitPrice,
          outcome: r.outcome,
          lostReason: r.lostReason,
          estimatorName: r.estimatorName,
          routingText: r.routingText,
          routingOps: r.routingOps as object[],
          importBatchId: batch.id,
          searchText: r.searchText,
          createdAt: now,
        })),
      });
      const skipped = analysis.counts.rows - analysis.counts.failed - count;
      await tx.importBatch.update({ where: { id: batch.id }, data: { rowsImported: count, rowsSkipped: skipped } });
      await recordAudit(tx, {
        actorId: user.id,
        entityType: "ImportBatch",
        entityId: batch.id,
        action: "import.past_quotes",
        summary: `${user.name} imported ${count.toLocaleString("en-IN")} past quotes from ${file.filename} (${skipped} skipped, ${analysis.counts.failed} with errors)`,
        data: { sha256: analysis.sha256, rows: analysis.counts.rows },
        at: now,
      });
      return { batchId: batch.id, imported: count, skipped, failed: analysis.counts.failed };
    },
    { timeout: 60_000 },
  );
}

export interface ImportBatchRow {
  id: string;
  filename: string;
  createdAt: string;
  createdBy: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  issues: RowIssue[];
}

export async function listImportBatches(db: DbOrTx, limit = 20): Promise<ImportBatchRow[]> {
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { createdBy: { select: { name: true } } } });
  return batches.map((b) => ({
    id: b.id,
    filename: b.filename,
    createdAt: isoStr(b.createdAt),
    createdBy: b.createdBy.name,
    rowsTotal: b.rowsTotal,
    rowsImported: b.rowsImported,
    rowsSkipped: b.rowsSkipped,
    rowsFailed: b.rowsFailed,
    issues: (b.issues ?? []) as unknown as RowIssue[],
  }));
}
