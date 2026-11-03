import Decimal from "decimal.js";
import { Dec, dec, isDecimalString, paise, sum } from "../money";
import {
  ENGINE_VERSION,
  type CostingContext,
  type CostingInput,
  type CostingIssue,
  type CostingResult,
  type LineKey,
  type OperationInput,
  type RateRef,
  type TierResult,
} from "./types";

/**
 * The costing engine (DESIGN.md §3). Deterministic decimal arithmetic, no AI.
 *
 * Rounding rule: every breakup line is rounded half-up to the paisa and computed from the
 * rounded lines it depends on, so the printed breakup always adds up and can be re-checked with
 * a calculator. Each operation is rounded on its own; setup and scrap are rounded once, as totals.
 */

const SCALE = { weight: 3, minutes: 3, percent: 3, money: 2, rate: 4 } as const;
const MAX_TIERS = 3;
const MARGIN_RANGE = [-20, 60] as const;
const REJECTION_RANGE = [0, 10] as const;
const LOW_YIELD_PCT = 40;
const LONG_CYCLE_MIN = 120;
const BENCHMARK_DEVIATION = 0.25;

// ─── input normalization ───────────────────────────────────────────────────────

function roundStr(value: string | null, dp: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!isDecimalString(trimmed)) return trimmed; // left as typed; validation reports it
  return dec(trimmed).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);
}

function normalizeRate(rate: RateRef | null): RateRef | null {
  return rate ? { ...rate, value: roundStr(rate.value, SCALE.rate) ?? rate.value } : null;
}

/**
 * Rounds every input to the scale of the column it is stored in (weights and minutes 3 dp,
 * percentages 3 dp, money 2 dp, rates 4 dp) so a costing recomputed from the database is
 * identical to the one the estimator saw.
 */
export function normalizeCostingInput(input: CostingInput): CostingInput {
  return {
    ...input,
    grossWeightKg: roundStr(input.grossWeightKg, SCALE.weight),
    forgedWeightKg: roundStr(input.forgedWeightKg, SCALE.weight),
    netWeightKg: roundStr(input.netWeightKg, SCALE.weight),
    scaleLossPct: roundStr(input.scaleLossPct, SCALE.percent),
    material: normalizeRate(input.material),
    turningsScrap: normalizeRate(input.turningsScrap),
    flashScrap: normalizeRate(input.flashScrap),
    bop: input.bop.map((b) => ({
      ...b,
      rate: normalizeRate(b.rate),
      quantity: roundStr(b.quantity, SCALE.weight) ?? b.quantity,
    })),
    operations: input.operations.map((op) => ({
      ...op,
      rate: normalizeRate(op.rate),
      cycleTimeMin: roundStr(op.cycleTimeMin, SCALE.minutes),
      setupMin: roundStr(op.setupMin, SCALE.minutes),
    })),
    rejectionPct: roundStr(input.rejectionPct, SCALE.percent) ?? input.rejectionPct,
    overheadPct: normalizeRate(input.overheadPct),
    iccRatePct: normalizeRate(input.iccRatePct),
    iccDays: normalizeRate(input.iccDays),
    packing: normalizeRate(input.packing),
    freight: normalizeRate(input.freight),
    tooling: { ...input.tooling, cost: roundStr(input.tooling.cost, SCALE.money) ?? input.tooling.cost },
    tiers: input.tiers.map((t) => ({ ...t, marginPct: roundStr(t.marginPct, SCALE.percent) ?? t.marginPct })),
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────────

const fmtKg = (d: Decimal) => `${d.toFixed(SCALE.weight).replace(/\.?0+$/, "")} kg`;

/** Parses a decimal string; null when absent or not a number. */
function num(value: string | null | undefined): Decimal | null {
  return value !== null && value !== undefined && isDecimalString(value) ? dec(value) : null;
}

function rateValue(rate: RateRef | null): Decimal | null {
  return rate ? num(rate.value) : null;
}

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b);
}

type Issues = CostingIssue[];

function err(issues: Issues, code: string, message: string, field?: string, scope: CostingIssue["scope"] = "part") {
  issues.push({ code, severity: "error", scope, field, message });
}

function warn(issues: Issues, code: string, message: string, field?: string, tierIndex?: number) {
  issues.push({ code, severity: "warning", scope: tierIndex === undefined ? "part" : "tier", field, tierIndex, message });
}

// ─── part-level computation (independent of volume) ────────────────────────────

interface PartFigures {
  gross: Decimal;
  forged: Decimal | null;
  net: Decimal;
  rawMaterial: Decimal;
  scrapCredit: Decimal; // positive amount; printed negative
  netMaterial: Decimal;
  bop: Decimal;
  inHouse: Decimal;
  outside: Decimal;
  setupPerBatch: Decimal;
  rejectionFactor: Decimal;
  overheadFactor: Decimal;
  iccFactor: Decimal;
  packing: Decimal;
  freight: Decimal;
}

function weightFor(basis: OperationInput["weightBasis"], w: { gross: Decimal; forged: Decimal | null; net: Decimal }) {
  if (basis === "NET") return w.net;
  if (basis === "FORGED") return w.forged;
  return w.gross;
}

// ─── public API ────────────────────────────────────────────────────────────────

export function computeCosting(raw: CostingInput, context: CostingContext = {}): CostingResult {
  const input = normalizeCostingInput(raw);
  const issues: Issues = [];

  // Weights
  const gross = num(input.grossWeightKg);
  const net = num(input.netWeightKg);
  const forged = input.forgedWeightKg === null ? null : num(input.forgedWeightKg);
  const scaleLoss = input.scaleLossPct === null ? dec(0) : num(input.scaleLossPct);

  if (gross === null) err(issues, "GROSS_WEIGHT_MISSING", "Enter the gross (input) weight.", "grossWeightKg");
  else if (gross.lte(0)) err(issues, "GROSS_WEIGHT_INVALID", "Gross weight must be more than 0 kg.", "grossWeightKg");
  if (net === null) err(issues, "NET_WEIGHT_MISSING", "Enter the net (finished) weight.", "netWeightKg");
  else if (net.lte(0)) err(issues, "NET_WEIGHT_INVALID", "Net weight must be more than 0 kg.", "netWeightKg");
  if (gross && net && gross.gt(0) && net.gt(0) && net.gt(gross)) {
    err(issues, "NET_GT_GROSS", `Net weight ${fmtKg(net)} is more than gross weight ${fmtKg(gross)}.`, "netWeightKg");
  }
  if (input.forgedWeightKg !== null && forged === null) {
    err(issues, "FORGED_WEIGHT_INVALID", "Forged weight is not a number.", "forgedWeightKg");
  }
  if (forged && gross && net && (forged.lt(net) || forged.gt(gross))) {
    err(issues, "FORGED_OUT_OF_RANGE", `Forged weight ${fmtKg(forged)} must be between net ${fmtKg(net)} and gross ${fmtKg(gross)}.`, "forgedWeightKg");
  }
  if (scaleLoss === null || scaleLoss.lt(0) || scaleLoss.gte(20)) {
    err(issues, "SCALE_LOSS_INVALID", "Scale loss must be between 0 % and 20 %.", "scaleLossPct");
  }

  // Material and scrap
  const rm = rateValue(input.material);
  const turnings = rateValue(input.turningsScrap);
  const flash = rateValue(input.flashScrap);
  if (rm === null) err(issues, "MATERIAL_RATE_MISSING", "Choose a material with a rate on the basis date.", "material");
  if (turnings === null) err(issues, "TURNINGS_RATE_MISSING", "No turnings scrap rate on the basis date.", "turningsScrap");
  if (forged && flash === null) {
    err(issues, "FLASH_RATE_MISSING", "Forged parts need a flash / end-bit scrap rate.", "flashScrap");
  }
  for (const [rate, field] of [[turnings, "turningsScrap"], [forged ? flash : null, "flashScrap"]] as const) {
    if (rm && rate && rate.gte(rm)) {
      err(issues, "SCRAP_RATE_NOT_BELOW_RM", "A scrap rate must be lower than the material rate.", field);
    }
  }
  let flashKg: Decimal | null = null;
  let turningsKg: Decimal | null = null;
  let scaleKg: Decimal | null = null;
  if (gross && net && scaleLoss) {
    if (forged) {
      scaleKg = gross.times(scaleLoss).dividedBy(100);
      flashKg = gross.minus(scaleKg).minus(forged);
      turningsKg = forged.minus(net);
      if (flashKg.lt(0)) {
        err(issues, "FORGED_PLUS_SCALE_GT_GROSS", "Forged weight plus scale loss is more than the gross weight.", "forgedWeightKg");
      }
    } else {
      turningsKg = gross.minus(net);
    }
  }

  // Bought-out parts
  const bopResults = input.bop.map((b) => {
    const rate = rateValue(b.rate);
    const qty = num(b.quantity);
    if (rate === null) err(issues, "BOP_UNBOUND", `Choose a bought-out item for "${b.name}".`, `bop.${b.id}.rate`);
    if (qty === null || qty.lte(0)) err(issues, "BOP_QTY_INVALID", `Quantity for "${b.name}" must be more than 0.`, `bop.${b.id}.quantity`);
    const cost = rate && qty && qty.gt(0) ? paise(rate.times(qty)) : null;
    return { id: b.id, cost };
  });

  // Operations
  const weights = gross && net ? { gross, forged, net } : null;
  const opResults = input.operations.map((op) => {
    const rate = rateValue(op.rate);
    const label = op.name || `Operation ${op.seq}`;
    let cost: Decimal | null = null;
    let setupPerBatch: Decimal | null = null;
    if (rate === null) {
      err(issues, "OPERATION_UNBOUND", `Choose a work centre for "${label}".`, `operations.${op.id}.rate`);
    } else if (op.kind === "MACHINE") {
      const cycle = num(op.cycleTimeMin);
      const setup = op.setupMin === null ? dec(0) : num(op.setupMin);
      if (cycle === null) err(issues, "CYCLE_TIME_MISSING", `Enter the cycle time for "${label}".`, `operations.${op.id}.cycleTimeMin`);
      else if (cycle.lt(0)) err(issues, "TIME_NEGATIVE", `Cycle time for "${label}" cannot be negative.`, `operations.${op.id}.cycleTimeMin`);
      else if (cycle.gt(LONG_CYCLE_MIN)) warn(issues, "CYCLE_TIME_HIGH", `Cycle time for "${label}" is over ${LONG_CYCLE_MIN} minutes — check the unit.`, `operations.${op.id}.cycleTimeMin`);
      if (setup === null || setup.lt(0)) err(issues, "TIME_NEGATIVE", `Setup time for "${label}" must be 0 or more minutes.`, `operations.${op.id}.setupMin`);
      if (cycle && cycle.gte(0)) cost = paise(cycle.dividedBy(60).times(rate));
      if (setup && setup.gte(0)) setupPerBatch = setup.dividedBy(60).times(rate);
    } else if (op.kind === "PROCESS_KG") {
      if (op.weightBasis === null) {
        err(issues, "WEIGHT_BASIS_MISSING", `Choose which weight "${label}" is charged on.`, `operations.${op.id}.weightBasis`);
      } else if (op.weightBasis === "FORGED" && input.forgedWeightKg === null) {
        err(issues, "FORGED_BASIS_WITHOUT_FORGED", `"${label}" is charged on forged weight, but no forged weight is entered.`, `operations.${op.id}.weightBasis`);
      } else if (weights) {
        const w = weightFor(op.weightBasis, weights);
        if (w) cost = paise(rate.times(w));
      }
    } else {
      cost = paise(rate);
    }
    return { op, cost, setupPerBatch };
  });

  // A machined or forged part always has at least one operation; without it the price would
  // be material only — a precise-looking wrong number.
  if (input.operations.length === 0) {
    err(issues, "ROUTING_EMPTY", "Add the routing — at least one operation.", "operations");
  }

  // Commercials
  const rejection = num(input.rejectionPct);
  if (rejection === null || rejection.lt(REJECTION_RANGE[0]) || rejection.gt(REJECTION_RANGE[1])) {
    err(issues, "REJECTION_OUT_OF_RANGE", `Rejection allowance must be between ${REJECTION_RANGE[0]} % and ${REJECTION_RANGE[1]} %.`, "rejectionPct");
  }
  const overhead = rateValue(input.overheadPct);
  if (overhead === null) err(issues, "OVERHEAD_RATE_MISSING", "No overhead % in the commercial master on the basis date.", "overheadPct");
  const iccRate = rateValue(input.iccRatePct);
  const iccDays = rateValue(input.iccDays);
  if (iccRate === null || iccDays === null) err(issues, "ICC_RATE_MISSING", "No ICC interest rate or inventory days in the commercial master on the basis date.", "iccRatePct");
  const packing = rateValue(input.packing);
  const freight = rateValue(input.freight);
  if (packing === null) warn(issues, "PACKING_MISSING", "No packing chosen — packing is costed at ₹0.", "packing");
  if (freight === null) warn(issues, "FREIGHT_MISSING", "No freight zone chosen — freight is costed at ₹0.", "freight");
  if (!Number.isInteger(input.batchesPerYear) || input.batchesPerYear < 1 || input.batchesPerYear > 365) {
    err(issues, "BATCHES_INVALID", "Batches per year must be a whole number from 1 to 365.", "batchesPerYear");
  }
  const toolingCost = num(input.tooling.cost);
  if (input.tooling.mode !== "NONE" && (toolingCost === null || toolingCost.lt(0))) {
    err(issues, "TOOLING_COST_INVALID", "Tooling cost must be 0 or more.", "tooling.cost");
  }
  const amortYears = input.tooling.amortYears;
  if (input.tooling.mode === "AMORTIZED" && (amortYears === null || !Number.isInteger(amortYears) || amortYears < 1 || amortYears > 10)) {
    err(issues, "TOOLING_YEARS_MISSING", "Amortized tooling needs a period of 1 to 10 years.", "tooling.amortYears");
  }

  // Yield
  const yieldPct = gross && net && gross.gt(0) ? net.dividedBy(gross).times(100).toDecimalPlaces(1) : null;
  if (yieldPct && yieldPct.lt(LOW_YIELD_PCT) && net && gross && net.lte(gross)) {
    warn(issues, "YIELD_LOW", `Yield is ${yieldPct.toFixed(1)} % (net ÷ gross) — check the weights.`, "netWeightKg");
  }

  // Tiers
  const tierErrors = new Map<number, true>();
  const baseCount = input.tiers.filter((t) => t.isBase).length;
  if (input.tiers.length > 0 && baseCount !== 1) {
    err(issues, baseCount === 0 ? "BASE_TIER_MISSING" : "BASE_TIER_MULTIPLE", "Exactly one volume must be the RFQ (base) volume.", "tiers");
  }
  const seenVolumes = new Set<number>();
  input.tiers.forEach((tier, i) => {
    const margin = num(tier.marginPct);
    if (!Number.isInteger(tier.volume) || tier.volume <= 0) {
      issues.push({ code: "VOLUME_INVALID", severity: "error", scope: "tier", tierIndex: i, field: `tiers.${i}.volume`, message: "Volume must be a whole number above 0." });
      tierErrors.set(i, true);
    } else if (seenVolumes.has(tier.volume)) {
      issues.push({ code: "VOLUME_DUPLICATE", severity: "error", scope: "tier", tierIndex: i, field: `tiers.${i}.volume`, message: `Volume ${tier.volume.toLocaleString("en-IN")} is quoted twice.` });
      tierErrors.set(i, true);
    } else {
      seenVolumes.add(tier.volume);
    }
    if (margin === null || margin.lt(MARGIN_RANGE[0]) || margin.gt(MARGIN_RANGE[1])) {
      issues.push({ code: "MARGIN_OUT_OF_RANGE", severity: "error", scope: "tier", tierIndex: i, field: `tiers.${i}.marginPct`, message: `Margin must be between ${MARGIN_RANGE[0]} % and ${MARGIN_RANGE[1]} %.` });
      tierErrors.set(i, true);
    } else if (context.marginFloorPct && isDecimalString(context.marginFloorPct) && margin.lt(context.marginFloorPct)) {
      warn(issues, "MARGIN_BELOW_FLOOR", `Margin ${margin.toString()} % is below the ${dec(context.marginFloorPct).toString()} % floor.`, `tiers.${i}.marginPct`, i);
    }
  });
  if (input.tiers.length < 2) {
    err(issues, "TIERS_TOO_FEW", "Quote at least two volumes before submitting.", "tiers", "submit");
  }
  if (input.tiers.length > MAX_TIERS) {
    err(issues, "TIERS_TOO_MANY", `Quote at most ${MAX_TIERS} volumes.`, "tiers", "submit");
  }

  const priceable = !issues.some((i) => i.severity === "error" && i.scope === "part");

  // Part-level money (only meaningful when priceable)
  let part: PartFigures | null = null;
  if (priceable && gross && net && rm && turnings && overhead && iccRate && iccDays && rejection) {
    const rawMaterial = paise(gross.times(rm));
    const creditRaw =
      forged && flashKg && turningsKg && flash
        ? flashKg.times(flash).plus(turningsKg.times(turnings))
        : (turningsKg ?? dec(0)).times(turnings);
    const scrapCredit = paise(creditRaw);
    const netMaterial = rawMaterial.minus(scrapCredit);
    const bop = sum(bopResults.map((b) => b.cost ?? 0));
    const inHouse = sum(opResults.filter((r) => r.op.kind === "MACHINE" || r.op.inHouse).map((r) => r.cost ?? 0));
    const outside = sum(opResults.filter((r) => r.op.kind !== "MACHINE" && !r.op.inHouse).map((r) => r.cost ?? 0));
    const setupPerBatch = sum(opResults.map((r) => r.setupPerBatch ?? 0));
    part = {
      gross,
      forged,
      net,
      rawMaterial,
      scrapCredit,
      netMaterial,
      bop,
      inHouse,
      outside,
      setupPerBatch,
      rejectionFactor: rejection.dividedBy(100),
      overheadFactor: overhead.dividedBy(100),
      iccFactor: iccRate.dividedBy(100).times(iccDays).dividedBy(365),
      packing: packing ? paise(packing) : dec(0),
      freight: freight ? paise(freight.times(net)) : dec(0),
    };
  }

  const tiers: TierResult[] = input.tiers.map((tier, i) => {
    const batchQty = Number.isInteger(tier.volume) && tier.volume > 0 && input.batchesPerYear > 0 ? ceilDiv(tier.volume, input.batchesPerYear) : 0;
    const lines = part && !tierErrors.has(i) ? tierLines(part, tier.volume, batchQty, dec(tier.marginPct), input) : null;
    return { volume: tier.volume, isBase: tier.isBase, marginPct: tier.marginPct, batchQty, lines };
  });

  // Benchmark against similar past quotes (base tier)
  const baseTierIndex = input.tiers.findIndex((t) => t.isBase);
  const baseLines = baseTierIndex >= 0 ? tiers[baseTierIndex]?.lines : null;
  const median = context.similarMedianConversionPerKg;
  if (baseLines && median && isDecimalString(median) && dec(median).gt(0)) {
    const deviation = dec(baseLines.conversionPerKg).minus(median).dividedBy(median);
    if (deviation.abs().gt(BENCHMARK_DEVIATION)) {
      const pctText = deviation.times(100).toDecimalPlaces(0).toString();
      warn(issues, "CONVERSION_PER_KG_DEVIATION", `Conversion ₹/kg is ${deviation.gt(0) ? "+" : ""}${pctText} % against the median of similar past quotes (₹${dec(median).toFixed(2)}/kg).`, `tiers.${baseTierIndex}.conversionPerKg`, baseTierIndex);
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    priceable,
    issues,
    weights: {
      flashKg: flashKg ? flashKg.toFixed(SCALE.weight) : null,
      turningsKg: turningsKg ? turningsKg.toFixed(SCALE.weight) : null,
      scaleKg: scaleKg ? scaleKg.toFixed(SCALE.weight) : null,
      yieldPct: yieldPct ? yieldPct.toFixed(1) : null,
    },
    operations: opResults.map((r) => ({
      id: r.op.id,
      costPerPiece: r.cost ? r.cost.toFixed(2) : null,
      setupPerBatch: r.setupPerBatch ? paise(r.setupPerBatch).toFixed(2) : null,
    })),
    bop: bopResults.map((b) => ({ id: b.id, costPerPiece: b.cost ? b.cost.toFixed(2) : null })),
    setupPerBatch: part ? paise(part.setupPerBatch).toFixed(2) : null,
    tiers,
    baseTierIndex: baseTierIndex >= 0 ? baseTierIndex : null,
  };
}

function tierLines(
  p: PartFigures,
  volume: number,
  batchQty: number,
  marginPct: Decimal,
  input: CostingInput,
): Record<LineKey, string> {
  const setup = paise(p.setupPerBatch.dividedBy(batchQty));
  const conversion = p.inHouse.plus(setup).plus(p.outside);
  const rejection = paise(p.rejectionFactor.times(p.netMaterial.plus(p.bop).plus(conversion)));
  const overhead = paise(p.overheadFactor.times(p.inHouse.plus(setup)));
  const icc = paise(p.iccFactor.times(p.netMaterial.plus(p.bop)));
  const mfgCost = p.netMaterial.plus(p.bop).plus(conversion).plus(rejection).plus(overhead).plus(icc);
  const profitBase = input.marginBasis === "CONVERSION" ? p.inHouse.plus(setup) : mfgCost;
  const profit = paise(marginPct.dividedBy(100).times(profitBase));
  const tooling =
    input.tooling.mode === "AMORTIZED" && input.tooling.amortYears
      ? paise(dec(input.tooling.cost).dividedBy(new Dec(volume).times(input.tooling.amortYears)))
      : dec(0);
  const unitPrice = mfgCost.plus(profit).plus(p.packing).plus(p.freight).plus(tooling);

  const lines: Record<LineKey, Decimal> = {
    rawMaterial: p.rawMaterial,
    scrapCredit: p.scrapCredit.isZero() ? dec(0) : p.scrapCredit.negated(),
    netMaterial: p.netMaterial,
    bop: p.bop,
    inHouseProcess: p.inHouse,
    setup,
    outsideProcess: p.outside,
    conversion,
    rejection,
    overhead,
    icc,
    mfgCost,
    profit,
    packing: p.packing,
    freight: p.freight,
    tooling,
    unitPrice,
    annualValue: paise(unitPrice.times(volume)),
    pricePerKg: paise(unitPrice.dividedBy(p.net)),
    conversionPerKg: paise(unitPrice.minus(p.netMaterial).dividedBy(p.net)),
  };
  return Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.toFixed(2)])) as Record<LineKey, string>;
}
