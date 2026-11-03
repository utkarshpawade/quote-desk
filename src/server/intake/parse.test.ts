import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toCandidate } from "@/domain/intake/read";
import { readByRules } from "@/domain/intake/rules";
import { readDrawingPdf, readPartList } from "./parse";

const pack = (name: string, file: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "sample-data", "rfq-packs", name, file)));
const materials = [
  { id: "m1", grade: "20MnCr5", aliases: [] },
  { id: "m2", grade: "38MnVS6", aliases: [] },
  { id: "m3", grade: "40Cr4", aliases: ["EN18"] },
  { id: "m4", grade: "EN8", aliases: [] },
];

describe("reading the sample RFQ documents", () => {
  it("cuts a drawing PDF down to its title block and finds process cues in the notes locally", async () => {
    const d = await readDrawingPdf(pack("company-d-gear-blank", "drawing-DRV-GB-2207-rev-C.pdf"));
    expect(d.hasText).toBe(true);
    expect(d.usedRegion).toBe("title-block");
    expect(d.titleBlockText).toContain("DRV-GB-2207");
    expect(d.titleBlockText).toContain("20MnCr5");
    expect(d.titleBlockText).not.toContain("PHOSPHATE"); // notes stay out of what may be sent to AI
    expect(d.hints).toEqual(expect.arrayContaining(["isothermal annealing", "phosphating"]));

    const read = Object.fromEntries(readByRules(d.titleBlockText, "TITLE_BLOCK").map((r) => [r.fieldKey, r.raw]));
    expect(read).toMatchObject({ partNo: "DRV-GB-2207", drawingRev: "C", material: "20MnCr5" });
  });

  it("reads a part list with its cell addresses and confirms a whole column", () => {
    const r = readPartList(pack("company-d-gear-blank", "part-list.xlsx"), "part-list.xlsx");
    expect(r.meta.mapped.map((m) => m.field)).toEqual(expect.arrayContaining(["partNo", "description", "material", "grossWeightKg", "netWeightKg", "annualVolume"]));
    const gross = r.values.find((v) => v.fieldKey === "grossWeightKg")!;
    expect(gross).toMatchObject({ raw: "1.48 kg", locator: "Sheet1!E2", column: { letter: "E", header: "Gross Wt (kg)" } });
  });

  it("converts weights from a grams column and flags the blank volume", () => {
    const r = readPartList(pack("company-e-brake-hub", "part-list.xlsx"), "part-list.xlsx");
    const spacer = r.values.filter((v) => v.part?.partNo === "E-SPC-314");
    const gross = toCandidate(spacer.find((v) => v.fieldKey === "grossWeightKg")!, { id: "x", kind: "EXCEL", label: "Excel", text: "", mode: "PARSER" }, { materials })!;
    expect(gross).toMatchObject({ value: "0.185", confidence: "MEDIUM", reason: "converted from 185 g" });
    expect(spacer.find((v) => v.fieldKey === "annualVolume")).toBeUndefined();
  });
});
