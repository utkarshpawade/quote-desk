import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { checkZipDirectory, readSpreadsheet, SpreadsheetError } from "./spreadsheet";

function workbookBytes(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Parts");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("readSpreadsheet", () => {
  it("reads cells with their Excel addresses", () => {
    const bytes = workbookBytes([
      ["Part No", "Description", "Annual Qty"],
      ["DRV-GB-2207", "Gear blank", 60000],
    ]);
    const { kind, sheets } = readSpreadsheet(bytes, "parts.xlsx");
    expect(kind).toBe("xlsx");
    const qty = sheets[0]!.rows[1]!.find((c) => c.col === 3)!;
    expect(qty).toMatchObject({ address: "C2", row: 2, col: 3, value: 60000 });
  });

  it("reads CSV text", () => {
    const bytes = new TextEncoder().encode("Part No,Qty\nA-1,\"1,80,000\"\n");
    const { kind, sheets } = readSpreadsheet(bytes, "list.csv");
    expect(kind).toBe("csv");
    expect(sheets[0]!.rows[1]![1]!.text).toBe("1,80,000");
  });

  it("refuses files that are not spreadsheets", () => {
    expect(() => readSpreadsheet(new TextEncoder().encode("%PDF-1.7"), "drawing.pdf")).toThrow(SpreadsheetError);
  });

  it("refuses sheets over the row limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`P-${i}`, i]);
    expect(() => readSpreadsheet(workbookBytes(rows), "big.xlsx", { maxRows: 10 })).toThrow(/more than 10 rows/);
  });

  it("refuses a zip that is not a workbook", () => {
    // Minimal empty zip: just an end-of-central-directory record.
    const eocd = new Uint8Array(22);
    new DataView(eocd.buffer).setUint32(0, 0x06054b50, true);
    expect(() => checkZipDirectory(eocd)).toThrow(/not an Excel workbook/);
  });
});
