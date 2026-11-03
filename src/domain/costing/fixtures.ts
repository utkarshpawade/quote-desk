import type { CostingInput, OperationInput, RateRef, RateUnit, TierInput } from "./types";

/**
 * The three golden fixtures of DESIGN.md §3.5–3.7, built from the brief's sample RFQs.
 * Shared by the engine tests, the PDF tests and the seed so the numbers a reviewer reads in the
 * TDD are the numbers the app produces.
 */

function ref(code: string, name: string, unit: RateUnit, value: string): RateRef {
  return { versionId: `v-${code}`, itemId: `i-${code}`, code, name, unit, value, effectiveFrom: "2026-10-01" };
}

function machine(seq: number, name: string, rate: RateRef, cycleTimeMin: string, setupMin: string): OperationInput {
  return { id: `op${seq}`, seq, name, kind: "MACHINE", rate, inHouse: true, cycleTimeMin, setupMin, weightBasis: null };
}

function perKg(seq: number, name: string, rate: RateRef, inHouse: boolean, weightBasis: "GROSS" | "FORGED" | "NET"): OperationInput {
  return { id: `op${seq}`, seq, name, kind: "PROCESS_KG", rate, inHouse, cycleTimeMin: null, setupMin: null, weightBasis };
}

function perPiece(seq: number, name: string, rate: RateRef, inHouse: boolean): OperationInput {
  return { id: `op${seq}`, seq, name, kind: "PROCESS_PC", rate, inHouse, cycleTimeMin: null, setupMin: null, weightBasis: null };
}

function tiers(volumes: [number, number, number], margins: [string, string, string]): TierInput[] {
  return volumes.map((volume, i) => ({ volume, marginPct: margins[i]!, isBase: i === 1 }));
}

const commercial = {
  rejectionPct: "2",
  overheadPct: ref("OVERHEAD_PCT", "Overhead on in-house conversion", "PERCENT", "15"),
  iccRatePct: ref("ICC_RATE_PCT", "ICC interest rate", "PERCENT", "12"),
  iccDays: ref("ICC_DAYS", "ICC inventory days", "DAYS", "45"),
  batchesPerYear: 12,
};

const saw = ref("MC-SAW", "Bandsaw bar cutting", "PER_HOUR", "350");
const turnings = ref("SCRAP-TURNINGS", "Steel turnings", "PER_KG", "26");
const flash = ref("SCRAP-FLASH", "Forging flash and end-bits", "PER_KG", "34");

/** Fixture A — RFQ-2611-014, rear wheel spindle, EN8, bar-turned, 1,80,000/yr. */
export function spindleFixture(): CostingInput {
  return {
    grossWeightKg: "0.61",
    forgedWeightKg: null,
    netWeightKg: "0.47",
    scaleLossPct: null,
    material: ref("MAT-EN8", "EN8 bright bar", "PER_KG", "72.50"),
    turningsScrap: turnings,
    flashScrap: null,
    bop: [],
    operations: [
      machine(10, "Bar cutting", saw, "0.35", "15"),
      machine(20, "CNC turning", ref("MC-CNC-TURN", "CNC turning centre", "PER_HOUR", "850"), "3.2", "45"),
      machine(30, "Thread rolling", ref("MC-THREAD-ROLL", "Thread rolling machine", "PER_HOUR", "600"), "0.40", "30"),
      perPiece(40, "Induction hardening", ref("PR-IH", "Induction hardening (job work)", "PER_PIECE", "3.20"), false),
    ],
    ...commercial,
    packing: ref("PK-VCI-BOX", "VCI bag + corrugated box", "PER_PIECE", "1.80"),
    freight: ref("FR-PUNE", "Freight — Pune zone", "PER_KG", "1.20"),
    tooling: { mode: "NONE", cost: "0", amortYears: null },
    marginBasis: "MFG_COST",
    tiers: tiers([120_000, 180_000, 240_000], ["14", "12", "10.5"]),
  };
}

/** Fixture B — RFQ-2611-019, hydraulic lift arm, 40Cr4 forged in-house, 24,000/yr, amortized dies. */
export function liftArmFixture(): CostingInput {
  return {
    grossWeightKg: "4.60",
    forgedWeightKg: "3.95",
    netWeightKg: "3.40",
    scaleLossPct: "2",
    material: ref("MAT-40CR4", "40Cr4 hot-rolled bar", "PER_KG", "84"),
    turningsScrap: turnings,
    flashScrap: flash,
    bop: [],
    operations: [
      machine(10, "Bar cutting", saw, "0.60", "15"),
      perKg(20, "Hot forging", ref("PR-FORGE", "Hot forging (1600 T press)", "PER_KG", "36"), true, "FORGED"),
      perKg(30, "Hardening & tempering", ref("PR-HT", "Hardening & tempering (job work)", "PER_KG", "19"), false, "FORGED"),
      perKg(40, "Shot blasting", ref("PR-SHOT", "Shot blasting (job work)", "PER_KG", "4"), false, "FORGED"),
      machine(50, "HMC machining", ref("MC-HMC", "Horizontal machining centre", "PER_HOUR", "1450"), "11.5", "120"),
      perPiece(60, "MPI crack detection", ref("PR-MPI", "Magnetic particle inspection (job work)", "PER_PIECE", "4.50"), false),
    ],
    ...commercial,
    packing: ref("PK-CRATE", "Wooden crate (heavy parts)", "PER_PIECE", "9.50"),
    freight: ref("FR-MH", "Freight — Maharashtra zone", "PER_KG", "2.40"),
    tooling: { mode: "AMORTIZED", cost: "1200000", amortYears: 3 },
    marginBasis: "MFG_COST",
    tiers: tiers([16_000, 24_000, 32_000], ["14", "12", "10.5"]),
  };
}

/** Fixture C — RFQ-2611-023, gear blank, 20MnCr5 forged, 60,000/yr, profit on conversion, separate dies. */
export function gearBlankFixture(): CostingInput {
  return {
    grossWeightKg: "1.48",
    forgedWeightKg: "1.30",
    netWeightKg: "1.12",
    scaleLossPct: "2",
    material: ref("MAT-20MNCR5", "20MnCr5 hot-rolled bar", "PER_KG", "90"),
    turningsScrap: turnings,
    flashScrap: flash,
    bop: [],
    operations: [
      machine(10, "Bar cutting", saw, "0.40", "15"),
      perKg(20, "Hot upset forging", ref("PR-FORGE", "Hot forging (1600 T press)", "PER_KG", "36"), true, "FORGED"),
      perKg(30, "Isothermal annealing", ref("PR-ISO", "Isothermal annealing (job work)", "PER_KG", "16"), false, "FORGED"),
      perKg(40, "Shot blasting", ref("PR-SHOT", "Shot blasting (job work)", "PER_KG", "4"), false, "FORGED"),
      machine(50, "CNC turning", ref("MC-CNC-HEAVY", "CNC turning centre (heavy)", "PER_HOUR", "950"), "4.8", "60"),
      perKg(60, "Phosphating & oiling", ref("PR-PHOS", "Phosphating & oiling (job work)", "PER_KG", "6"), false, "NET"),
    ],
    ...commercial,
    packing: ref("PK-BIN", "Returnable plastic bin", "PER_PIECE", "0.90"),
    freight: ref("FR-MH", "Freight — Maharashtra zone", "PER_KG", "2.40"),
    tooling: { mode: "SEPARATE", cost: "240000", amortYears: null },
    marginBasis: "CONVERSION",
    tiers: tiers([40_000, 60_000, 80_000], ["20", "18", "16.5"]),
  };
}
