import * as XLSX from "xlsx";

/**
 * Reads .xlsx, .xls and .csv uploads into plain cells, defensively:
 * - .xlsx is a zip, so the central directory is checked before SheetJS inflates anything
 *   (must contain xl/workbook.xml; at most 50 MB uncompressed and 2,000 entries — zip-bomb guard);
 * - at most `maxRows` rows per sheet are read.
 * Shared by RFQ intake (part lists) and the past-quote import. Not `server-only` so the seed can
 * use it, but it is never imported by client components.
 */

export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

export type CellValue = string | number | boolean | Date | null;

export interface SheetCell {
  /** "E4" */
  address: string;
  /** 1-based row and column, as the estimator sees them. */
  row: number;
  col: number;
  value: CellValue;
  /** The formatted text Excel would show ("1,80,000", "12-11-2026"). */
  text: string;
}

export interface SheetData {
  name: string;
  /** Row-major; each row holds only non-empty cells, in column order. */
  rows: SheetCell[][];
}

const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
const MAX_ENTRIES = 2_000;

type Kind = "xlsx" | "xls" | "csv";

function detectKind(bytes: Uint8Array, filename: string): Kind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  if (/\.csv$/i.test(filename)) return "csv";
  throw new SpreadsheetError("This file is not an Excel workbook (.xlsx / .xls) or a CSV file.");
}

/** Validates a zip's central directory without decompressing it. */
export function checkZipDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record: signature 0x06054b50 within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError("The workbook is damaged (no zip directory found).");

  const entries = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (entries > MAX_ENTRIES) throw new SpreadsheetError("The workbook has too many parts to be safe to open.");

  let offset = dirOffset;
  let total = 0;
  let hasWorkbook = false;
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new SpreadsheetError("The workbook is damaged (bad zip directory).");
    }
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === "xl/workbook.xml") hasWorkbook = true;
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED) {
      throw new SpreadsheetError("The workbook expands to more than 50 MB and was not opened.");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!hasWorkbook) throw new SpreadsheetError("This zip file is not an Excel workbook.");
}

export function readSpreadsheet(
  bytes: Uint8Array,
  filename: string,
  options: { maxRows?: number } = {},
): { kind: Kind; sheets: SheetData[] } {
  const maxRows = options.maxRows ?? 5_000;
  const kind = detectKind(bytes, filename);
  if (kind === "xlsx") checkZipDirectory(bytes);

  let workbook: XLSX.WorkBook;
  try {
    workbook =
      kind === "csv"
        ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", sheetRows: maxRows + 1 })
        : XLSX.read(bytes, { type: "array", cellDates: true, sheetRows: maxRows + 1 });
  } catch {
    throw new SpreadsheetError("The file could not be read as a spreadsheet.");
  }

  const sheets: SheetData[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet["!ref"]) return { name, rows: [] };
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r - range.s.r + 1 > maxRows) {
      throw new SpreadsheetError(`Sheet "${name}" has more than ${maxRows.toLocaleString("en-IN")} rows.`);
    }
    const rows: SheetCell[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: SheetCell[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[address] as XLSX.CellObject | undefined;
        if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
        const value = cell.v as CellValue;
        const text = (cell.w ?? (value instanceof Date ? value.toISOString().slice(0, 10) : String(value))).trim();
        row.push({ address, row: r + 1, col: c + 1, value, text });
      }
      rows.push(row);
    }
    return { name, rows };
  });

  return { kind, sheets };
}

/** Column letter for a 1-based column index: 5 → "E". */
export function columnLetter(col: number): string {
  return XLSX.utils.encode_col(col - 1);
}
