import { computeCosting } from "../../src/domain/costing/engine";
import type { CostingInput, OperationInput, RateRef } from "../../src/domain/costing/types";
import { resolveAt } from "../../src/domain/rates/resolve";
import { SEED_ITEMS } from "../../src/server/seed/catalog";

/**
 * 1,400 rows of the legacy quote register (A-16), priced with the real costing engine on the rate
 * history in force on each quote date, so "what did we quote last year" — and its RM-adjusted
 * comparison — behaves like the client's real history would. Deterministic (seeded PRNG).
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LEGACY_HEADERS = [
  "Quote No",
  "Quote Date",
  "Customer",
  "Part No",
  "Part Description",
  "Material",
  "Gross Wt (kg)",
  "Net Wt (kg)",
  "Annual Qty",
  "Unit Price (Rs)",
  "Status",
  "Lost Reason",
  "Routing",
  "Estimator",
] as const;

export type LegacyRow = Record<(typeof LEGACY_HEADERS)[number], string | number | Date | null>;

const ITEMS = new Map(SEED_ITEMS.map((i) => [i.code, i]));

/** A seed item's rate on a date; before its first version, the first value eased back ~4 %/yr. */
function rate(code: string, date: string): RateRef {
  const item = ITEMS.get(code)!;
  const versions = item.versions
    .filter(([from]) => from !== "NEXT")
    .map(([from, value], i) => ({ id: `${code}-${i}`, effectiveFrom: from, value, voidedAt: null }));
  const v = resolveAt(versions, date);
  let value = v?.value;
  if (!value) {
    const first = versions[0]!;
    const years = (Date.parse(first.effectiveFrom) - Date.parse(date)) / (365 * 86_400_000);
    value = (Number(first.value) * Math.pow(0.96, Math.max(0, years))).toFixed(2);
  }
  return { versionId: v?.id ?? `${code}-old`, itemId: code, code, name: item.name, unit: item.unit, value, effectiveFrom: v?.effectiveFrom ?? date };
}

interface Family {
  names: string[];
  materials: string[];
  form: "BAR" | "FORGING";
  gross: [number, number];
  netRatio: [number, number];
  routing: (w: number, r: () => number) => Array<[code: string, legacy: string, cycle?: number]>;
}

const FAMILIES: Record<string, Family> = {
  spindle: {
    names: ["Front wheel spindle", "Rear wheel spindle", "Swing arm spindle", "Pivot shaft", "Wheel spindle LH", "Wheel spindle RH"],
    materials: ["MAT-EN8", "MAT-EN8D", "MAT-C45"],
    form: "BAR",
    gross: [0.35, 1.3],
    netRatio: [0.72, 0.82],
    routing: (w, r) => [
      ["MC-SAW", "Bar cutting", 0.3 + w * 0.08],
      ["MC-CNC-TURN", "Ace LT-20", 2 + w * 1.6 + r() * 0.6],
      ["MC-THREAD-ROLL", "Thread rolling", 0.4],
      ["PR-IH", "Induction hardening"],
    ],
  },
  axle: {
    names: ["Rear axle", "Front axle", "Wheel axle", "Kick start shaft", "Brake cam shaft"],
    materials: ["MAT-EN8D", "MAT-EN9", "MAT-C45"],
    form: "BAR",
    gross: [0.3, 1.1],
    netRatio: [0.7, 0.8],
    routing: (w, r) => [
      ["MC-SAW", "Bar cutting", 0.35],
      ["MC-CNC-TURN", "CNC-2", 2.2 + w * 1.8 + r() * 0.5],
      ["MC-GRIND", "Cyl grinding", 0.6 + w * 0.4],
      ["PR-IH", "Induction hardening"],
    ],
  },
  pin: {
    names: ["King pin", "Pivot pin", "Clevis pin", "Hinge pin", "Top link pin", "Caliper guide pin"],
    materials: ["MAT-C45", "MAT-42CRMO4", "MAT-EN9"],
    form: "BAR",
    gross: [0.12, 2.2],
    netRatio: [0.68, 0.8],
    routing: (w, r) => [
      ["MC-SAW", "Saw", 0.3],
      ["MC-CNC-TURN", "LT-20", 1.4 + w * 2 + r() * 0.4],
      ["PR-HT", "H&T"],
      ["MC-GRIND", "CG-1", 0.5 + w * 0.5],
    ],
  },
  gearBlank: {
    names: ["Gear blank", "Gear blank 42T", "Pinion blank", "Gear blank 38T", "Sun gear blank", "Ring gear blank"],
    materials: ["MAT-20MNCR5", "MAT-16MNCR5", "MAT-EN353"],
    form: "FORGING",
    gross: [0.8, 3.4],
    netRatio: [0.72, 0.8],
    routing: (w, r) => [
      ["MC-SAW", "Bar cutting", 0.4],
      ["PR-FORGE", "Upset forging"],
      ["PR-ISO", "Iso annealing"],
      ["PR-SHOT", "Shot blast"],
      ["MC-CNC-HEAVY", "LT-25", 2.6 + w * 1.5 + r() * 0.6],
      ["PR-PHOS", "Phosphating"],
    ],
  },
  hub: {
    names: ["Wheel hub", "Brake drum hub", "Flange hub", "Companion flange", "Output flange"],
    materials: ["MAT-38MNVS6", "MAT-40CR4", "MAT-42CRMO4"],
    form: "FORGING",
    gross: [1.6, 6.2],
    netRatio: [0.66, 0.76],
    routing: (w, r) => [
      ["MC-SAW", "Bar cutting", 0.5],
      ["PR-FORGE", "Hot forging"],
      ["PR-NORM", "Normalising"],
      ["PR-SHOT", "Shot blasting"],
      ["MC-CNC-HEAVY", "CNC-4", 3 + w * 1.3 + r() * 0.8],
      ["MC-VMC", "VMC-2", 1.2 + w * 0.4],
    ],
  },
  arm: {
    names: ["Hydraulic lift arm", "Hydraulic lift arm LH", "Lift arm RH", "Steering arm", "Brake lever", "Gear shift lever", "Slip yoke", "Flange yoke"],
    materials: ["MAT-40CR4", "MAT-42CRMO4", "MAT-C45"],
    form: "FORGING",
    gross: [0.4, 6.8],
    netRatio: [0.7, 0.78],
    routing: (w, r) => [
      ["MC-SAW", "Bar cutting", 0.6],
      ["PR-FORGE", "Hot forging"],
      ["PR-HT", "H&T"],
      ["PR-SHOT", "Shot blast"],
      [w > 2 ? "MC-HMC" : "MC-VMC", w > 2 ? "HMC-1" : "VMC-2", 3 + w * 1.6 + r() * 1],
      ["PR-MPI", "Crack detection"],
    ],
  },
};

const CUSTOMERS: Array<{ name: string; families: string[]; volume: [number, number]; weight: number }> = [
  { name: "Company B", families: ["spindle", "axle", "pin", "arm"], volume: [60_000, 300_000], weight: 5 },
  { name: "Company C", families: ["arm", "pin", "hub"], volume: [8_000, 40_000], weight: 4 },
  { name: "Company D", families: ["gearBlank", "hub"], volume: [20_000, 120_000], weight: 4 },
  { name: "Company E", families: ["hub", "pin", "axle"], volume: [12_000, 90_000], weight: 3 },
  { name: "Company F", families: ["arm", "pin", "hub"], volume: [2_000, 15_000], weight: 2 },
  { name: "Company G", families: ["pin", "arm", "hub"], volume: [6_000, 30_000], weight: 2 },
  { name: "Company H", families: ["axle", "spindle", "pin"], volume: [80_000, 260_000], weight: 3 },
];

const ESTIMATORS = ["R. Deshpande", "K. Shinde", "A. Patil", "S. Kulkarni", "I. Shaikh", "P. Jadhav", "M. Gokhale"];
const LOST_REASONS: Array<[string, number]> = [
  ["Price", 50],
  ["Lead time", 15],
  ["Technical", 10],
  ["Late reply", 15],
  ["Incumbent retained", 10],
];

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

function weighted<T>(r: () => number, list: Array<[T, number]>): T {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of list) if ((x -= w) <= 0) return v;
  return list[0]![0];
}

function round(n: number, step: number) {
  return Math.round(n / step) * step;
}

/** Indian financial year of a date: 2025-03-31 → "24-25", 2025-04-01 → "25-26". */
function fy(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Rows chosen to demo "what did we quote last year" for the brief's three sample parts. */
const ANCHORS: Array<{ ref: string; date: string; customer: string; partNo: string; description: string; family: string; material: string; gross: number; net: number; volume: number; status: string; cycle?: number }> = [
  { ref: "Q/24-25/0412", date: "2025-03-14", customer: "Company B", partNo: "CB-FWS-0588", description: "Front wheel spindle", family: "spindle", material: "MAT-EN8", gross: 0.58, net: 0.45, volume: 200_000, status: "Won", cycle: 3.0 },
  { ref: "Q/25-26/0233", date: "2025-08-21", customer: "Company C", partNo: "CC-HLA-4402", description: "Hydraulic lift arm LH", family: "arm", material: "MAT-40CR4", gross: 4.4, net: 3.25, volume: 20_000, status: "Won", cycle: 11.0 },
  { ref: "Q/25-26/0301", date: "2025-10-09", customer: "Company D", partNo: "DRV-GB-2150", description: "Gear blank 42T", family: "gearBlank", material: "MAT-20MNCR5", gross: 1.42, net: 1.08, volume: 54_000, status: "Won", cycle: 4.6 },
];

function priceFor(familyKey: string, material: string, gross: number, net: number, volume: number, date: string, r: () => number, cycleOverride?: number) {
  const family = FAMILIES[familyKey]!;
  const routing = family.routing(gross, r).map(([code, legacy, cycle], i): [string, string, number | undefined] => [code, legacy, i === 1 && cycleOverride ? cycleOverride : cycle]);
  const forged = family.form === "FORGING" ? (gross * 0.86).toFixed(3) : null;
  const operations: OperationInput[] = routing.map(([code, , cycle], i) => {
    const ref = rate(code, date);
    const kind = ref.unit === "PER_HOUR" ? "MACHINE" : ref.unit === "PER_KG" ? "PROCESS_KG" : "PROCESS_PC";
    const attrs = ITEMS.get(code)!.attributes ?? {};
    const basis = (attrs.defaultWeightBasis as "GROSS" | "FORGED" | "NET" | undefined) ?? "GROSS";
    return {
      id: `op${i}`,
      seq: (i + 1) * 10,
      name: ref.name,
      kind,
      rate: ref,
      inHouse: kind === "MACHINE" ? true : attrs.inHouse === true,
      cycleTimeMin: kind === "MACHINE" ? (cycle ?? 1).toFixed(2) : null,
      setupMin: kind === "MACHINE" ? "45" : null,
      weightBasis: kind === "PROCESS_KG" ? (basis === "FORGED" && !forged ? "GROSS" : basis) : null,
    };
  });
  const input: CostingInput = {
    grossWeightKg: gross.toFixed(3),
    forgedWeightKg: forged,
    netWeightKg: net.toFixed(3),
    scaleLossPct: forged ? "2" : null,
    material: rate(material, date),
    turningsScrap: rate("SCRAP-TURNINGS", date),
    flashScrap: forged ? rate("SCRAP-FLASH", date) : null,
    bop: [],
    operations,
    rejectionPct: "2",
    overheadPct: rate("OVERHEAD_PCT", date),
    iccRatePct: rate("ICC_RATE_PCT", date),
    iccDays: rate("ICC_DAYS", date),
    packing: rate(gross > 2.5 ? "PK-CRATE" : "PK-VCI-BOX", date),
    freight: rate("FR-MH", date),
    tooling: { mode: "NONE", cost: "0", amortYears: null },
    batchesPerYear: 12,
    marginBasis: "MFG_COST",
    tiers: [{ volume, marginPct: (9 + r() * 7).toFixed(1), isBase: true }],
  };
  const result = computeCosting(input);
  const unit = Number(result.tiers[0]?.lines?.unitPrice ?? "0");
  const noise = 1 + (r() - 0.5) * 0.08; // estimator judgement, ±4 %
  const routingText = routing.map(([, legacy, cycle]) => (cycle ? `${legacy} ${cycle.toFixed(1)}` : legacy)).join(" | ");
  return { unitPrice: (unit * noise).toFixed(2), routingText };
}

export function generatePastQuotes(count = 1_400, seed = 2611): LegacyRow[] {
  const r = mulberry32(seed);
  const rows: LegacyRow[] = [];
  const start = Date.parse("2023-04-03T00:00:00Z");
  const end = Date.parse("2026-09-30T00:00:00Z");
  const seq = new Map<string, number>();

  for (const a of ANCHORS) {
    const { unitPrice, routingText } = priceFor(a.family, a.material, a.gross, a.net, a.volume, a.date, r, a.cycle);
    rows.push({
      "Quote No": a.ref,
      "Quote Date": new Date(`${a.date}T00:00:00Z`),
      Customer: a.customer,
      "Part No": a.partNo,
      "Part Description": a.description,
      Material: ITEMS.get(a.material)!.attributes!.grade as string,
      "Gross Wt (kg)": a.gross,
      "Net Wt (kg)": a.net,
      "Annual Qty": a.volume,
      "Unit Price (Rs)": Number(unitPrice),
      Status: a.status,
      "Lost Reason": null,
      Routing: routingText,
      Estimator: "R. Deshpande",
    });
  }

  while (rows.length < count) {
    const date = new Date(start + r() * (end - start)).toISOString().slice(0, 10);
    const customer = weighted(r, CUSTOMERS.map((c) => [c, c.weight] as [typeof c, number]));
    const familyKey = pick(r, customer.families);
    const family = FAMILIES[familyKey]!;
    const gross = round(family.gross[0] + r() * (family.gross[1] - family.gross[0]), 0.01);
    const net = round(gross * (family.netRatio[0] + r() * (family.netRatio[1] - family.netRatio[0])), 0.01);
    const volume = round(customer.volume[0] + r() * (customer.volume[1] - customer.volume[0]), 1_000);
    const material = pick(r, family.materials);
    const { unitPrice, routingText } = priceFor(familyKey, material, gross, net, volume, date, r);
    const outcome = weighted(r, [
      ["Won", 35],
      ["Lost", 45],
      ["No response", 15],
      ["Regret", 5],
    ]);
    const year = fy(date);
    const n = (seq.get(year) ?? 500) + 1 + Math.floor(r() * 2);
    seq.set(year, n);
    const prefix = customer.name.slice(-1);
    rows.push({
      "Quote No": `Q/${year}/${String(n).padStart(4, "0")}`,
      "Quote Date": new Date(`${date}T00:00:00Z`),
      Customer: customer.name,
      "Part No": `${prefix}-${familyKey.slice(0, 3).toUpperCase()}-${String(1000 + Math.floor(r() * 8999))}`,
      "Part Description": pick(r, family.names),
      Material: ITEMS.get(material)!.attributes!.grade as string,
      "Gross Wt (kg)": gross,
      "Net Wt (kg)": net,
      "Annual Qty": volume,
      "Unit Price (Rs)": Number(unitPrice),
      Status: outcome,
      "Lost Reason": outcome === "Lost" ? weighted(r, LOST_REASONS) : null,
      Routing: r() < 0.75 ? routingText : null,
      Estimator: pick(r, ESTIMATORS),
    });
  }
  return rows.sort((a, b) => (a["Quote Date"] as Date).getTime() - (b["Quote Date"] as Date).getTime());
}

/** 60 rows with deliberate mistakes, to show the import's validation report. */
export function generateErrorSample(): LegacyRow[] {
  const rows = generatePastQuotes(60, 77).map((row, i) => ({ ...row, "Quote No": `Q/99-00/${String(9000 + i)}` }));
  rows[3]!["Part Description"] = null;
  rows[8]!["Unit Price (Rs)"] = -45;
  rows[12]!["Quote Date"] = "31/02/2025";
  rows[17]!.Status = "Maybe";
  rows[21]!["Net Wt (kg)"] = Number(rows[21]!["Gross Wt (kg)"]) + 0.5;
  rows[26]!["Annual Qty"] = "approx 20k";
  rows[33] = { ...rows[32]! };
  return rows;
}
