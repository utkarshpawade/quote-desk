import type { RateCategory } from "@/domain/rates/catalog";
import type { RateRef } from "@/domain/costing/types";

/**
 * Seed rate masters (A-9: illustrative 2026 Pune values) with price history back to April 2023,
 * so past quotes can be RM-adjusted, and one change scheduled for the first of next month so the
 * "next scheduled change" column is never empty.
 */

type Unit = RateRef["unit"];

export interface SeedItem {
  category: RateCategory;
  code: string;
  name: string;
  unit: Unit;
  attributes?: Record<string, unknown>;
  /** [effectiveFrom, value] oldest first; "NEXT" = first day of next month (scheduled). */
  versions: Array<[string, string]>;
}

const EN8_HISTORY: Array<[string, number]> = [
  ["2023-04-01", 61.0],
  ["2023-10-01", 63.5],
  ["2024-04-01", 66.5],
  ["2024-10-01", 65.0],
  ["2025-04-01", 69.0],
  ["2025-10-01", 70.5],
  ["2026-04-01", 71.0],
  ["2026-10-01", 72.5],
];

/** A steel's price path, following EN8's movement scaled to its current price, rounded to ₹0.50. */
function steel(current: number, next?: number): Array<[string, string]> {
  const ratio = current / 72.5;
  const history = EN8_HISTORY.map(([d, v]): [string, string] => [d, (Math.round(v * ratio * 2) / 2).toFixed(2)]);
  return next ? [...history, ["NEXT", next.toFixed(2)]] : history;
}

function material(code: string, grade: string, name: string, family: string, current: number, aliases: string[], next?: number): SeedItem {
  return {
    category: "MATERIAL",
    code,
    name,
    unit: "PER_KG",
    attributes: { grade, family, form: "BAR", aliases, turningsScrapCode: "SCRAP-TURNINGS", flashScrapCode: "SCRAP-FLASH" },
    versions: steel(current, next),
  };
}

function machine(code: string, name: string, current: number, aliases: string[]): SeedItem {
  const previous = Math.round((current * 0.95) / 10) * 10;
  return {
    category: "MACHINE",
    code,
    name,
    unit: "PER_HOUR",
    attributes: { machineType: name, aliases },
    versions: [
      ["2025-04-01", previous.toFixed(2)],
      ["2026-04-01", current.toFixed(2)],
    ],
  };
}

function process(
  code: string,
  name: string,
  unit: "PER_KG" | "PER_PIECE",
  current: number,
  inHouse: boolean,
  opts: { basis?: "GROSS" | "FORGED" | "NET"; aliases?: string[]; keywords?: string[] } = {},
): SeedItem {
  return {
    category: "PROCESS",
    code,
    name,
    unit,
    attributes: { inHouse, aliases: opts.aliases ?? [], defaultWeightBasis: opts.basis, drawingKeywords: opts.keywords ?? [] },
    versions: [
      ["2025-04-01", (current * 0.94).toFixed(2)],
      ["2026-04-01", current.toFixed(2)],
    ],
  };
}

const commercial = (code: string, name: string, unit: Unit, versions: Array<[string, string]>): SeedItem => ({
  category: "COMMERCIAL",
  code,
  name,
  unit,
  versions,
});

export const SEED_ITEMS: SeedItem[] = [
  // Materials (₹/kg, ex-GST, delivered Chakan)
  material("MAT-EN8", "EN8", "EN8 bright bar", "MEDIUM_CARBON", 72.5, ["EN 8", "EN-8", "080M40", "C40"], 74.0),
  material("MAT-EN8D", "EN8D", "EN8D bright bar", "MEDIUM_CARBON", 74.0, ["EN 8D", "EN-8D", "080A42"]),
  material("MAT-C45", "C45", "C45 bright bar", "MEDIUM_CARBON", 72.0, ["C-45", "CK45", "1045"]),
  material("MAT-EN9", "EN9", "EN9 bright bar", "MEDIUM_CARBON", 75.5, ["EN 9", "070M55", "C55"]),
  material("MAT-40CR4", "40Cr4", "40Cr4 hot-rolled bar", "ALLOY", 84.0, ["40 Cr 4", "41Cr4", "EN18", "530A40"]),
  material("MAT-42CRMO4", "42CrMo4", "42CrMo4 hot-rolled bar", "ALLOY", 96.0, ["EN19", "EN 19", "708M40", "4140"]),
  material("MAT-20MNCR5", "20MnCr5", "20MnCr5 hot-rolled bar", "CASE_HARDENING", 90.0, ["20 MnCr 5", "20MNCR5", "SAE 5120"]),
  material("MAT-16MNCR5", "16MnCr5", "16MnCr5 hot-rolled bar", "CASE_HARDENING", 88.0, ["16 MnCr 5", "16MNCR5"]),
  material("MAT-EN353", "EN353", "EN353 hot-rolled bar", "CASE_HARDENING", 98.0, ["EN 353", "815M17"]),
  material("MAT-38MNVS6", "38MnVS6", "38MnVS6 micro-alloyed bar", "MICROALLOY", 86.0, ["38MnSiVS5", "38 MnVS 6"]),

  // Scrap (₹/kg)
  {
    category: "SCRAP",
    code: "SCRAP-TURNINGS",
    name: "Steel turnings",
    unit: "PER_KG",
    attributes: { kind: "TURNINGS" },
    versions: [["2023-04-01", "21.00"], ["2024-04-01", "23.00"], ["2025-04-01", "24.50"], ["2026-04-01", "25.50"], ["2026-10-01", "26.00"], ["NEXT", "27.00"]],
  },
  {
    category: "SCRAP",
    code: "SCRAP-FLASH",
    name: "Forging flash and end-bits",
    unit: "PER_KG",
    attributes: { kind: "FLASH" },
    versions: [["2023-04-01", "28.00"], ["2024-04-01", "30.00"], ["2025-04-01", "32.00"], ["2026-04-01", "33.00"], ["2026-10-01", "34.00"]],
  },

  // Machines (₹/hour) — aliases are the names used in the old Excel register
  machine("MC-SAW", "Bandsaw bar cutting", 350, ["Saw", "Bar cutting", "BS-1"]),
  machine("MC-CNC-TURN", "CNC turning centre", 850, ["Ace LT-20", "LT-20", "CNC-2", "CNC turning"]),
  machine("MC-CNC-HEAVY", "CNC turning centre (heavy)", 950, ["LT-25", "CNC-4", "CNC turning heavy"]),
  machine("MC-VMC", "Vertical machining centre", 1250, ["VMC-2", "VMC", "BFW VMC"]),
  machine("MC-HMC", "Horizontal machining centre", 1450, ["HMC-1", "HMC", "Makino HMC"]),
  machine("MC-HOB", "Gear hobbing", 1100, ["Hob-1", "Hobbing"]),
  machine("MC-THREAD-ROLL", "Thread rolling machine", 600, ["Thread rolling", "TR-1"]),
  machine("MC-GRIND", "Cylindrical grinding", 750, ["Cyl grinding", "CG-1", "Grinding"]),
  machine("MC-DRILL", "Radial drilling", 450, ["Radial drill", "RD-1", "Drilling"]),
  machine("MC-BROACH", "Broaching", 900, ["Broach", "BR-1"]),

  // Processes (₹/kg or ₹/pc); in-house ones attract overhead, job work does not
  process("PR-FORGE", "Hot forging (1600 T press)", "PER_KG", 36, true, { basis: "FORGED", aliases: ["Forging", "Hot forging", "Upset forging"], keywords: ["FORGE", "FORGING"] }),
  process("PR-NORM", "Normalising (job work)", "PER_KG", 10, false, { basis: "FORGED", aliases: ["Normalising", "Normalizing"], keywords: ["NORMALISE", "NORMALIZE"] }),
  process("PR-ISO", "Isothermal annealing (job work)", "PER_KG", 16, false, { basis: "FORGED", aliases: ["Iso annealing", "Isothermal annealing"], keywords: ["ISOTHERMAL", "ANNEAL"] }),
  process("PR-HT", "Hardening & tempering (job work)", "PER_KG", 19, false, { basis: "FORGED", aliases: ["H&T", "Hardening and tempering"], keywords: ["HARDEN AND TEMPER", "H&T", "QUENCH"] }),
  process("PR-CARB", "Case carburising + H&T (job work)", "PER_KG", 48, false, { basis: "NET", aliases: ["Carburising", "Case carburizing"], keywords: ["CARBURI", "CASE DEPTH"] }),
  process("PR-SHOT", "Shot blasting (job work)", "PER_KG", 4, false, { basis: "FORGED", aliases: ["Shot blasting", "Shot blast"], keywords: ["SHOT BLAST"] }),
  process("PR-PHOS", "Phosphating & oiling (job work)", "PER_KG", 6, false, { basis: "NET", aliases: ["Phosphating"], keywords: ["PHOSPHAT"] }),
  process("PR-IH", "Induction hardening (job work)", "PER_PIECE", 3.2, false, { aliases: ["Induction hardening", "IH"], keywords: ["INDUCTION HARDEN"] }),
  process("PR-MPI", "Magnetic particle inspection (job work)", "PER_PIECE", 4.5, false, { aliases: ["MPI", "Crack detection"], keywords: ["MPI", "CRACK"] }),
  process("PR-ZINC", "Zinc plating (job work)", "PER_PIECE", 2.8, false, { aliases: ["Zinc plating", "Plating"], keywords: ["ZINC", "PLATING"] }),
  process("PR-LASER", "Laser marking", "PER_PIECE", 0.6, true, { aliases: ["Marking", "Laser marking"], keywords: ["LASER MARK"] }),

  // Bought-out parts (₹/pc)
  { category: "BOP", code: "BOP-NUT-M20", name: "Hex nut M20×1.5", unit: "PER_PIECE", versions: [["2026-04-01", "4.20"]] },
  { category: "BOP", code: "BOP-WASHER-20", name: "Spring washer 20", unit: "PER_PIECE", versions: [["2026-04-01", "0.80"]] },
  { category: "BOP", code: "BOP-BUSH", name: "Pressed steel bush", unit: "PER_PIECE", versions: [["2026-04-01", "14.50"]] },

  // Packing (₹/pc) and freight (₹/kg of net weight)
  { category: "PACKING", code: "PK-VCI-BOX", name: "VCI bag + corrugated box", unit: "PER_PIECE", versions: [["2025-04-01", "1.70"], ["2026-04-01", "1.80"]] },
  { category: "PACKING", code: "PK-BIN", name: "Returnable plastic bin", unit: "PER_PIECE", versions: [["2026-04-01", "0.90"]] },
  { category: "PACKING", code: "PK-CRATE", name: "Wooden crate (heavy parts)", unit: "PER_PIECE", versions: [["2025-04-01", "9.00"], ["2026-04-01", "9.50"]] },
  { category: "FREIGHT", code: "FR-PUNE", name: "Freight — Pune zone (≤ 50 km)", unit: "PER_KG", attributes: { zone: "Pune" }, versions: [["2025-04-01", "1.10"], ["2026-04-01", "1.20"]] },
  { category: "FREIGHT", code: "FR-MH", name: "Freight — Maharashtra", unit: "PER_KG", attributes: { zone: "Maharashtra" }, versions: [["2025-04-01", "2.25"], ["2026-04-01", "2.40"]] },
  { category: "FREIGHT", code: "FR-NORTH", name: "Freight — North & Central India", unit: "PER_KG", attributes: { zone: "North & Central" }, versions: [["2025-04-01", "3.90"], ["2026-04-01", "4.10"]] },
  { category: "FREIGHT", code: "FR-SOUTH", name: "Freight — South India", unit: "PER_KG", attributes: { zone: "South" }, versions: [["2025-04-01", "3.60"], ["2026-04-01", "3.80"]] },

  // Commercial policy (versioned like any rate)
  commercial("OVERHEAD_PCT", "Overhead on in-house conversion", "PERCENT", [["2024-04-01", "15.0000"]]),
  commercial("REJECTION_DEFAULT_PCT", "Default rejection allowance", "PERCENT", [["2024-04-01", "2.0000"]]),
  commercial("ICC_RATE_PCT", "ICC interest rate (p.a.)", "PERCENT", [["2024-04-01", "12.5000"], ["2025-04-01", "12.0000"]]),
  commercial("ICC_DAYS", "ICC inventory days", "DAYS", [["2024-04-01", "45.0000"]]),
  commercial("MARGIN_BASE_PCT", "Default margin at the RFQ volume", "PERCENT", [["2024-04-01", "12.0000"]]),
  commercial("MARGIN_BELOW_PP", "Margin adjustment below RFQ volume (pp)", "PERCENT", [["2024-04-01", "2.0000"]]),
  commercial("MARGIN_ABOVE_PP", "Margin adjustment above RFQ volume (pp)", "PERCENT", [["2024-04-01", "-1.5000"]]),
  commercial("MARGIN_FLOOR_PCT", "Margin floor (warning below)", "PERCENT", [["2024-04-01", "8.0000"]]),
  commercial("APPROVAL_THRESHOLD", "Sales head approval above annual value", "RUPEES", [["2024-04-01", "2500000.0000"]]),
  commercial("BATCHES_PER_YEAR", "Production batches per year", "COUNT", [["2024-04-01", "12.0000"]]),
  commercial("SCALE_LOSS_DEFAULT_PCT", "Forging scale loss (default)", "PERCENT", [["2024-04-01", "2.0000"]]),
  commercial("GST_18", "GST — motor vehicle parts (HSN 8708)", "PERCENT", [["2025-09-22", "18.0000"]]),
  commercial("GST_5", "GST — specified tractor parts", "PERCENT", [["2025-09-22", "5.0000"]]),
];

export const SEED_USERS = {
  salesHead: { email: "vikram.joshi@companya.example", name: "Vikram Joshi", role: "SALES_HEAD" as const },
  estimators: [
    { email: "rohan.deshpande@companya.example", name: "Rohan Deshpande" },
    { email: "kavita.shinde@companya.example", name: "Kavita Shinde" },
    { email: "arjun.patil@companya.example", name: "Arjun Patil" },
    { email: "sneha.kulkarni@companya.example", name: "Sneha Kulkarni" },
    { email: "imran.shaikh@companya.example", name: "Imran Shaikh" },
    { email: "pooja.jadhav@companya.example", name: "Pooja Jadhav" },
  ],
};

export interface SeedCustomer {
  key: string;
  code: string;
  name: string;
  segment: "TWO_WHEELER" | "TRACTOR" | "DRIVETRAIN" | "TIER1" | "OFF_HIGHWAY" | "COMMERCIAL_VEHICLE";
  city: string;
  address: string;
  emailDomain: string;
  contactName: string;
  paymentTerms: string;
  marginBasis: "MFG_COST" | "CONVERSION";
  freight: string;
  packing: string;
  aiAllowed: boolean;
}

/** Companies B, C and D are from the brief; E–H are invented (A-14). */
export const SEED_CUSTOMERS: SeedCustomer[] = [
  { key: "B", code: "CUST-B", name: "Company B", segment: "TWO_WHEELER", city: "Pune", address: "Plant 2, Akurdi\nPune 411035, Maharashtra", emailDomain: "companyb.example", contactName: "Purchase — chassis parts", paymentTerms: "60 days from invoice", marginBasis: "MFG_COST", freight: "FR-PUNE", packing: "PK-VCI-BOX", aiAllowed: true },
  { key: "C", code: "CUST-C", name: "Company C", segment: "TRACTOR", city: "Nagpur", address: "MIDC Hingna\nNagpur 440016, Maharashtra", emailDomain: "companyc.example", contactName: "Strategic sourcing — hydraulics", paymentTerms: "45 days from invoice", marginBasis: "MFG_COST", freight: "FR-MH", packing: "PK-CRATE", aiAllowed: true },
  { key: "D", code: "CUST-D", name: "Company D", segment: "DRIVETRAIN", city: "Chhatrapati Sambhajinagar", address: "Waluj MIDC\nChhatrapati Sambhajinagar 431136, Maharashtra", emailDomain: "companyd.example", contactName: "Purchase — gears", paymentTerms: "60 days from invoice", marginBasis: "CONVERSION", freight: "FR-MH", packing: "PK-BIN", aiAllowed: true },
  { key: "E", code: "CUST-E", name: "Company E", segment: "TIER1", city: "Chennai", address: "Oragadam Industrial Corridor\nChennai 602105, Tamil Nadu", emailDomain: "companye.example", contactName: "Purchase — brakes", paymentTerms: "75 days from invoice", marginBasis: "MFG_COST", freight: "FR-SOUTH", packing: "PK-VCI-BOX", aiAllowed: true },
  { key: "F", code: "CUST-F", name: "Company F", segment: "OFF_HIGHWAY", city: "Pithampur", address: "Sector 3, Pithampur\nDhar 454775, Madhya Pradesh", emailDomain: "companyf.example", contactName: "Purchase — driveline", paymentTerms: "60 days from invoice", marginBasis: "MFG_COST", freight: "FR-NORTH", packing: "PK-CRATE", aiAllowed: true },
  { key: "G", code: "CUST-G", name: "Company G", segment: "COMMERCIAL_VEHICLE", city: "Jamshedpur", address: "Adityapur Industrial Area\nJamshedpur 832109, Jharkhand", emailDomain: "companyg.example", contactName: "Purchase — axles", paymentTerms: "90 days from invoice", marginBasis: "MFG_COST", freight: "FR-NORTH", packing: "PK-CRATE", aiAllowed: false },
  { key: "H", code: "CUST-H", name: "Company H", segment: "TWO_WHEELER", city: "Hosur", address: "SIPCOT Phase 1\nHosur 635126, Tamil Nadu", emailDomain: "companyh.example", contactName: "Purchase — new projects", paymentTerms: "60 days from invoice", marginBasis: "MFG_COST", freight: "FR-SOUTH", packing: "PK-VCI-BOX", aiAllowed: true },
];
