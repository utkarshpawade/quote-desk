import { getDocumentProxy } from "unpdf";
import { mapColumns } from "@/domain/intake/excel-columns";
import { processHints } from "@/domain/intake/process-hints";
import type { RawValue } from "@/domain/intake/read";
import { UserError } from "@/server/errors";
import { columnLetter, readSpreadsheet, type SheetCell } from "@/server/files/spreadsheet";

/**
 * Deterministic readers for uploaded documents. Excel part lists need no AI; drawing PDFs are cut
 * down to their title block before anything is sent to the AI (NDA).
 */

export interface ExcelReading {
  values: RawValue[];
  meta: { sheet: string; headerRow: number; mapped: Array<{ field: string; header: string; letter: string }>; unmapped: string[]; rows: number };
}

/** Units written in a header ("Gross Wt (kg)", "Net wt in g") apply to the bare numbers below it. */
function headerUnit(header: string): string {
  if (/\(\s*kgs?\s*\)|\bin\s*kg\b|\bkg\b/i.test(header)) return " kg";
  if (/\(\s*(g|gm|gms|grams?)\s*\)|\bin\s*(g|grams?)\b/i.test(header)) return " g";
  return "";
}

export function readPartList(bytes: Uint8Array, filename: string): ExcelReading {
  const { sheets } = readSpreadsheet(bytes, filename, { maxRows: 1_000 });
  for (const sheet of sheets) {
    for (let r = 0; r < Math.min(15, sheet.rows.length); r++) {
      const headerCells = sheet.rows[r]!.filter((c) => typeof c.value === "string");
      const { mapped, unmapped } = mapColumns(headerCells.map((c) => ({ text: c.text, col: c.col })));
      if (mapped.length < 3) continue;

      const values: RawValue[] = [];
      let rows = 0;
      for (const row of sheet.rows.slice(r + 1)) {
        const cellAt = (col: number): SheetCell | undefined => row.find((c) => c.col === col);
        const present = mapped.filter((m) => cellAt(m.col));
        if (present.length === 0) continue;
        rows++;
        const partNo = mapped.find((m) => m.field === "partNo");
        const description = mapped.find((m) => m.field === "description");
        const part = {
          partNo: partNo ? (cellAt(partNo.col)?.text ?? null) : null,
          description: description ? (cellAt(description.col)?.text ?? null) : null,
          row: cellAt(present[0]!.col)!.row,
        };
        for (const m of present) {
          const cell = cellAt(m.col)!;
          const isMonthly = m.field === "monthlyVolume";
          const unit = m.field.endsWith("WeightKg") && /^\d[\d.,]*$/.test(cell.text) ? headerUnit(m.header) : "";
          values.push({
            fieldKey: isMonthly ? "annualVolume" : m.field,
            raw: `${cell.text}${unit}${isMonthly ? " per month" : ""}`,
            evidence: cell.text,
            locator: `${sheet.name}!${cell.address}`,
            part,
            column: { letter: columnLetter(m.col), header: m.header },
          });
        }
      }
      return {
        values,
        meta: { sheet: sheet.name, headerRow: r + 1, mapped: mapped.map((m) => ({ field: m.field, header: m.header, letter: columnLetter(m.col) })), unmapped, rows },
      };
    }
  }
  throw new UserError("No part-list header row found (looked for columns like Part No, Description, Material, Annual Qty).");
}

export interface DrawingText {
  hasText: boolean;
  /** Only the title-block region (bottom-right, ISO 7200) — this is all that may be sent to the AI. */
  titleBlockText: string;
  usedRegion: "title-block" | "full-page";
  /** Process cues found locally in the whole sheet (notes stay on our side). */
  hints: string[];
}

interface Item {
  str: string;
  x: number;
  y: number;
}

function toLines(items: Item[]): string {
  const rows: Array<{ y: number; items: Item[] }> = [];
  for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str).join("  ").replace(/\s{3,}/g, "  ").trim()).filter(Boolean).join("\n");
}

const TITLE_LABEL = /^(customer|part\s*name|title|description|part\s*no\.?|drg\s*no\.?|drawing\s*no\.?|rev(ision)?|material|weight|finish(ed)?\s*(wt|weight)?|scale|sheet|heat\s*treatment|ht|projection|units|tolerances.*)$/i;

/**
 * Title blocks print each label above its value in the same cell. Pairing them by position gives
 * "PART NO: DRV-GB-2207" lines, which read the same way for the AI, the rules and grounding.
 */
function pairTitleBlock(items: Item[]): string {
  const used = new Set<Item>();
  const pairs: string[] = [];
  const labels = items.filter((i) => TITLE_LABEL.test(i.str)).sort((a, b) => b.y - a.y || a.x - b.x);
  for (const label of labels) {
    const value = items
      .filter((i) => i !== label && !used.has(i) && !TITLE_LABEL.test(i.str) && i.y < label.y && label.y - i.y < 30 && Math.abs(i.x - label.x) < 12)
      .sort((a, b) => b.y - a.y)[0];
    if (!value) continue;
    used.add(label);
    used.add(value);
    pairs.push(`${label.str.toUpperCase()}: ${value.str}`);
  }
  const rest = items.filter((i) => !used.has(i));
  return [...pairs, ...(rest.length ? [toLines(rest)] : [])].join("\n");
}

export async function readDrawingPdf(bytes: Uint8Array): Promise<DrawingText> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const page = await pdf.getPage(1);
  const { width, height } = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: Item[] = (content.items as Array<{ str?: string; transform?: number[] }>)
    .filter((i) => i.str && i.str.trim() && i.transform)
    .map((i) => ({ str: i.str!.trim(), x: i.transform![4]!, y: i.transform![5]! }));
  if (items.length === 0) return { hasText: false, titleBlockText: "", usedRegion: "title-block", hints: [] };

  const all = toLines(items);
  // PDF origin is bottom-left: the title block sits right of 45 % width and in the bottom 40 %.
  const block = items.filter((i) => i.x >= width * 0.45 && i.y <= height * 0.4);
  return {
    hasText: true,
    titleBlockText: block.length ? pairTitleBlock(block) : all,
    usedRegion: block.length ? "title-block" : "full-page",
    hints: processHints(all),
  };
}
