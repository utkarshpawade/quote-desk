import { describe, expect, it } from "vitest";
import { mapLegacyHeader, parseOutcome, parseRouting, readLegacyRow, type LegacyCell, type LegacyField, type WorkCentre } from "./legacy";

const centres: WorkCentre[] = [
  { itemId: "saw", name: "Bandsaw bar cutting", kind: "MACHINE", names: ["Bandsaw bar cutting", "MC-SAW", "Saw", "Bar cutting"], weightBasis: null },
  { itemId: "cnc", name: "CNC turning centre", kind: "MACHINE", names: ["CNC turning centre", "MC-CNC-TURN", "Ace LT-20", "LT-20"], weightBasis: null },
  { itemId: "forge", name: "Hot forging (1600 T press)", kind: "PROCESS_KG", names: ["PR-FORGE", "Hot forging", "Upset forging"], weightBasis: "FORGED" },
  { itemId: "ih", name: "Induction hardening (job work)", kind: "PROCESS_PC", names: ["PR-IH", "Induction hardening", "IH"], weightBasis: null },
];
const materials = [{ id: "en8", grade: "EN8", aliases: ["EN-8", "080M40"] }];
const ctx = { materials, centres, today: "2026-11-03" };

let col = 0;
const cell = (value: LegacyCell["value"], text?: string): LegacyCell => ({ value, text: text ?? (value instanceof Date ? "" : String(value ?? "")), address: `X${++col}` });

function row(over: Partial<Record<LegacyField, LegacyCell | undefined>> = {}) {
  const base: Partial<Record<LegacyField, LegacyCell>> = {
    refNo: cell("Q/24-25/0412"),
    quoteDate: cell(new Date("2025-03-14T05:30:00Z"), "14-03-2025"),
    customer: cell("Company B"),
    partNo: cell("CB-FWS-0588"),
    description: cell("Front wheel spindle"),
    material: cell("EN8"),
    grossWeightKg: cell(0.58),
    netWeightKg: cell(0.45),
    annualVolume: cell(200000),
    unitPrice: cell(104.87),
    status: cell("Won"),
    routing: cell("Bar cutting 0.3 | Ace LT-20 3.0 | Induction hardening"),
    estimator: cell("R. Deshpande"),
  };
  const merged = { ...base, ...over };
  for (const k of Object.keys(merged) as LegacyField[]) if (merged[k] === undefined) delete merged[k];
  return readLegacyRow(7, merged as Partial<Record<LegacyField, LegacyCell>>, ctx);
}

describe("legacy register header", () => {
  it("maps the register's headers and reports what is missing", () => {
    const headers = ["Quote No", "Quote Date", "Customer", "Part No", "Part Description", "Material", "Gross Wt (kg)", "Net Wt (kg)", "Annual Qty", "Unit Price (Rs)", "Status", "Lost Reason", "Routing", "Estimator"];
    const { mapped, missing, unmapped } = mapLegacyHeader(headers.map((text, i) => ({ text, col: i + 1 })));
    expect(missing).toEqual([]);
    expect(unmapped).toEqual([]);
    expect(mapped.map((m) => m.field)).toEqual(["refNo", "quoteDate", "customer", "partNo", "description", "material", "grossWeightKg", "netWeightKg", "annualVolume", "unitPrice", "status", "lostReason", "routing", "estimator"]);
  });

  it("accepts other spellings and names the required columns it cannot find", () => {
    const { mapped, missing } = mapLegacyHeader(["Qtn No", "Date", "Client", "Part Name", "Quoted Price"].map((text, i) => ({ text, col: i + 1 })));
    expect(mapped.map((m) => m.field)).toEqual(["refNo", "quoteDate", "customer", "description", "unitPrice"]);
    expect(missing).toEqual(["status"]);
  });
});

describe("legacy rows", () => {
  it("reads a clean row: grade matched, routing bound, bar-turned shaft", () => {
    const { record, issues } = row();
    expect(issues).toEqual([]);
    expect(record).toMatchObject({
      refNo: "Q/24-25/0412",
      quoteDate: "2025-03-14",
      materialItemId: "en8",
      grossWeightKg: "0.580",
      netWeightKg: "0.450",
      annualVolume: 200000,
      unitPrice: "104.87",
      outcome: "WON",
      inputForm: "BAR",
      shapeFamily: "shaft",
      searchText: "cb-fws-0588 · front wheel spindle · en8 · company b",
    });
    expect(record!.routingOps.map((o) => [o.itemId, o.cycleTimeMin])).toEqual([["saw", "0.30"], ["cnc", "3.00"], ["ih", null]]);
  });

  it("reads Excel dates the same in any time zone and text dates day-first", () => {
    expect(row({ quoteDate: cell(new Date("2025-03-13T18:30:00Z")) }).record!.quoteDate).toBe("2025-03-14"); // IST midnight
    expect(row({ quoteDate: cell("14/03/2025") }).record!.quoteDate).toBe("2025-03-14");
  });

  it.each([
    [{ description: undefined }, "Part description is empty"],
    [{ unitPrice: cell(-45) }, "Unit price -45 must be more than zero"],
    [{ quoteDate: cell("31/02/2025") }, "“31/02/2025” is not a valid date"],
    [{ quoteDate: cell("12/12/2026") }, "Quote date 12/12/2026 is in the future"],
    [{ status: cell("Maybe") }, "Status “Maybe” is not Won, Lost, No response, Regret or Open"],
    [{ netWeightKg: cell(0.95) }, "Net weight 0.95 kg is more than gross 0.58 kg"],
  ] as const)("keeps a row out when %j", (over, message) => {
    const { record, issues } = row(over as Partial<Record<LegacyField, LegacyCell>>);
    expect(record).toBeNull();
    expect(issues.map((i) => i.message)).toContain(message);
  });

  it("imports with a warning when only an optional value is doubtful", () => {
    const { record, issues } = row({ annualVolume: cell("approx 20k"), material: cell("SCM440") });
    expect(record).toMatchObject({ annualVolume: null, materialText: "SCM440", materialItemId: null });
    expect(issues.map((i) => [i.severity, i.message])).toEqual([
      ["warning", "Annual qty “approx 20k” is not a number — imported without it"],
      ["warning", "Material “SCM440” is not in the rate master — kept as text, no RM-adjusted price"],
    ]);
  });

  it("recognises forgings from the routing", () => {
    expect(row({ description: cell("Gear blank 42T"), routing: cell("Bar cutting 0.4 | Upset forging | LT-20 4.6") }).record).toMatchObject({ inputForm: "FORGING", shapeFamily: "disc" });
  });
});

describe("routing text and outcomes", () => {
  it("keeps unknown operations by their legacy name, unbound", () => {
    expect(parseRouting("Saw 0.3; Deburring; IH", centres)).toEqual([
      { name: "Bandsaw bar cutting", itemId: "saw", kind: "MACHINE", cycleTimeMin: "0.30", setupMin: null, weightBasis: null, legacyName: "Saw" },
      { name: "Deburring", itemId: null, kind: "PROCESS_PC", cycleTimeMin: null, setupMin: null, weightBasis: null, legacyName: "Deburring" },
      { name: "Induction hardening (job work)", itemId: "ih", kind: "PROCESS_PC", cycleTimeMin: null, setupMin: null, weightBasis: null, legacyName: "IH" },
    ]);
  });

  it.each([
    ["Won", "WON"],
    ["PO received", "WON"],
    ["lost", "LOST"],
    ["No response", "NO_RESPONSE"],
    ["Regret", "REGRETTED"],
    ["Maybe", null],
  ])("status %s → %s", (text, outcome) => {
    expect(parseOutcome(text)).toBe(outcome);
  });
});
