import { addWorkingDays, toDbDate, toIstDate, type IsoDate } from "@/domain/calendar";
import type { LineDraft } from "@/domain/costing/draft";
import { parseRfqNumber } from "@/domain/numbering";
import type { CloseReason } from "@/domain/status";
import type { Db } from "@/server/db-client";
import { hashPassword } from "@/server/auth/password";
import { raiseSequence } from "@/server/services/counters";
import { importPastQuotes, readSampleImport } from "@/server/services/past-quote-import";
import { closeRfq, approveQuote, getSnapshotBody, returnQuote, sendQuote, submitQuote } from "@/server/services/quote-lifecycle";
import { renderQuotePdfFor } from "@/server/services/quote-pdf";
import { basisParams, defaultDraft, newRowId, optionsAt, writeLine } from "@/server/services/quotes";
import { Catalog } from "@/server/services/rates";
import { createRfq } from "@/server/services/rfqs";
import { SEED_CUSTOMERS, SEED_ITEMS, SEED_USERS } from "./catalog";

/**
 * Demo data: rate masters with history, customers, the team, and ~25 RFQs replayed through the
 * real services at past times (so every frozen quote has a genuine snapshot and the activity log
 * reads like real work). Dates are relative to the day the seed runs; the nightly demo reset
 * re-runs it so due dates stay current.
 */

const APP_TABLES = [
  "RateItem", "RateVersion", "Customer", "Rfq", "RfqPart", "Quote", "QuoteParam", "QuoteSnapshot",
  "QuoteLine", "QuoteOperation", "QuoteTier", "IntakeSession", "IntakeSource", "ExtractedField",
  "FieldProvenance", "StoredFile", "FileAccess", "PastQuote", "ImportBatch", "AuditEvent",
  "OutboxMessage", "Counter",
];

type Op = [code: string, name: string, cycle?: string, setup?: string];

interface PartSpec {
  partNo: string;
  description: string;
  drawingRev?: string;
  material: string;
  materialText: string;
  gross: string;
  forged?: string;
  net: string;
  volume: number;
  ops: Op[];
  bop?: Array<[code: string, qty: string]>;
  tooling?: { mode: "SEPARATE" | "AMORTIZED"; cost: string; years?: number; note?: string };
  margins?: [string, string, string];
  activeMinutes?: number;
}

type Stage = "ESTIMATING" | "IN_APPROVAL" | "RETURNED" | "READY" | "SENT" | "WON" | "LOST" | "REGRETTED";

interface RfqSpec {
  number?: string;
  customer: string;
  subject: string;
  ref: string;
  owner: number;
  received: number; // working days ago
  due: number; // working days from today (negative = overdue)
  parts: PartSpec[];
  stage: Stage;
  submitAfter?: number; // working days after receipt
  approveAfter?: number; // working days after submit
  sendAfter?: number; // working days after approval
  closeAfterDays?: number; // calendar days after sending (or after receipt when never sent)
  reason?: CloseReason;
  note?: string;
  provenance?: "excel" | "ai";
}

// Routing templates
const shaft = (cycle: string, extra: Op[] = []): Op[] => [["MC-SAW", "Bar cutting", "0.40", "15"], ["MC-CNC-TURN", "CNC turning", cycle, "45"], ...extra];
const disc = (cycle: string): Op[] => [
  ["MC-SAW", "Bar cutting", "0.40", "15"],
  ["PR-FORGE", "Hot upset forging"],
  ["PR-ISO", "Isothermal annealing"],
  ["PR-SHOT", "Shot blasting"],
  ["MC-CNC-HEAVY", "CNC turning", cycle, "60"],
  ["PR-PHOS", "Phosphating & oiling"],
];
const arm = (cycle: string, centre = "MC-HMC"): Op[] => [
  ["MC-SAW", "Bar cutting", "0.60", "15"],
  ["PR-FORGE", "Hot forging"],
  ["PR-HT", "Hardening & tempering"],
  ["PR-SHOT", "Shot blasting"],
  [centre, centre === "MC-HMC" ? "HMC machining" : "VMC machining", cycle, centre === "MC-HMC" ? "120" : "90"],
  ["PR-MPI", "MPI crack detection"],
];

const SPINDLE: PartSpec = {
  partNo: "CB-RWS-0612",
  description: "Rear wheel spindle",
  drawingRev: "B",
  material: "MAT-EN8",
  materialText: "EN8",
  gross: "0.610",
  net: "0.470",
  volume: 180_000,
  ops: [
    ["MC-SAW", "Bar cutting", "0.35", "15"],
    ["MC-CNC-TURN", "CNC turning", "3.2", "45"],
    ["MC-THREAD-ROLL", "Thread rolling", "0.40", "30"],
    ["PR-IH", "Induction hardening"],
  ],
  margins: ["14", "12", "10.5"],
  activeMinutes: 38,
};

const LIFT_ARM: PartSpec = {
  partNo: "CC-HLA-4410",
  description: "Hydraulic lift arm",
  drawingRev: "D",
  material: "MAT-40CR4",
  materialText: "40Cr4 forging",
  gross: "4.600",
  forged: "3.950",
  net: "3.400",
  volume: 24_000,
  ops: [
    ["MC-SAW", "Bar cutting", "0.60", "15"],
    ["PR-FORGE", "Hot forging"],
    ["PR-HT", "Hardening & tempering"],
    ["PR-SHOT", "Shot blasting"],
    ["MC-HMC", "HMC machining", "11.5", "120"],
    ["PR-MPI", "MPI crack detection"],
  ],
  tooling: { mode: "AMORTIZED", cost: "1200000", years: 3, note: "Forging dies, trim tool and HMC fixture" },
  margins: ["14", "12", "10.5"],
  activeMinutes: 52,
};

const GEAR_BLANK: PartSpec = {
  partNo: "DRV-GB-2207",
  description: "Gear blank",
  drawingRev: "C",
  material: "MAT-20MNCR5",
  materialText: "20MnCr5",
  gross: "1.480",
  forged: "1.300",
  net: "1.120",
  volume: 60_000,
  ops: [], // left for the estimator: the routing suggestion from last year's gear blank is the demo
  activeMinutes: 0,
};

function scenario(): RfqSpec[] {
  return [
    // ── the three RFQs from the brief ──
    { number: "RFQ-2611-014", customer: "B", subject: "Rear wheel spindle — FY27 requirement", ref: "CB/PUR/RFQ/26/1182", owner: 0, received: 2, due: 2, parts: [SPINDLE], stage: "ESTIMATING", provenance: "excel" },
    { number: "RFQ-2611-019", customer: "C", subject: "Hydraulic lift arm — new 50 HP platform", ref: "CC/SCM/26/0871", owner: 1, received: 3, due: 1, parts: [LIFT_ARM], stage: "IN_APPROVAL", submitAfter: 2 },
    { number: "RFQ-2611-023", customer: "D", subject: "Gear blank DRV-GB-2207", ref: "DRV/RFQ/26/0457", owner: 0, received: 1, due: 8, parts: [GEAR_BLANK], stage: "ESTIMATING", provenance: "ai" },

    // ── open pipeline ──
    {
      customer: "H", subject: "Front axle and spacer — new scooter platform", ref: "H/NPD/26/219", owner: 2, received: 1, due: 4, stage: "ESTIMATING",
      parts: [
        { partNo: "H-FAX-118", description: "Front axle", material: "MAT-EN8D", materialText: "EN8D", gross: "0.550", net: "0.430", volume: 240_000, ops: shaft("2.6", [["MC-THREAD-ROLL", "Thread rolling", "0.35", "30"], ["PR-ZINC", "Zinc plating"]]), activeMinutes: 41 },
        { partNo: "H-SPC-121", description: "Wheel spacer", material: "MAT-EN8", materialText: "EN8", gross: "0.085", net: "0.052", volume: 240_000, ops: [] },
      ],
    },
    {
      customer: "E", subject: "Brake drum hub family — LH/RH", ref: "E/BRK/26/0332", owner: 3, received: 4, due: 0, stage: "IN_APPROVAL", submitAfter: 3,
      parts: [
        { partNo: "E-BDH-310L", description: "Brake drum hub LH", material: "MAT-38MNVS6", materialText: "38MnVS6 forging", gross: "3.200", forged: "2.750", net: "2.200", volume: 36_000, ops: disc("6.4"), activeMinutes: 58 },
        { partNo: "E-BDH-310R", description: "Brake drum hub RH", material: "MAT-38MNVS6", materialText: "38MnVS6 forging", gross: "3.200", forged: "2.750", net: "2.200", volume: 36_000, ops: disc("6.4"), activeMinutes: 12 },
      ],
    },
    {
      customer: "B", subject: "Swing arm pivot shaft", ref: "CB/PUR/RFQ/26/1121", owner: 4, received: 5, due: 1, stage: "RETURNED", submitAfter: 2, approveAfter: 1,
      note: "CNC turning at 4.9 min looks high against the front wheel spindle we quoted in 2025 (3.0 min). Please recheck before I approve.",
      parts: [{ partNo: "CB-SAP-0441", description: "Swing arm pivot shaft", material: "MAT-EN8", materialText: "EN8", gross: "0.920", net: "0.700", volume: 150_000, ops: shaft("4.9", [["MC-GRIND", "Cylindrical grinding", "0.9", "30"], ["PR-IH", "Induction hardening"]]), activeMinutes: 47 }],
    },
    {
      customer: "F", subject: "Slip yoke — service requirement", ref: "F/SRV/26/077", owner: 5, received: 3, due: 2, stage: "READY", submitAfter: 2,
      parts: [{ partNo: "F-SYK-2210", description: "Slip yoke", material: "MAT-42CRMO4", materialText: "42CrMo4 forging", gross: "2.100", forged: "1.800", net: "1.450", volume: 2_400, ops: arm("7.5", "MC-VMC"), activeMinutes: 44 }],
    },
    {
      customer: "G", subject: "King pin kit — HCV front axle", ref: "G/AXL/26/0145", owner: 1, received: 4, due: 1, stage: "READY", submitAfter: 2, approveAfter: 1,
      parts: [
        { partNo: "G-KP-5512", description: "King pin", material: "MAT-42CRMO4", materialText: "EN19", gross: "1.850", net: "1.400", volume: 12_000, ops: shaft("5.8", [["PR-HT", "Hardening & tempering"], ["MC-GRIND", "Cylindrical grinding", "1.6", "30"]]), activeMinutes: 63 },
        { partNo: "G-KPB-5513", description: "King pin bush", material: "MAT-EN8", materialText: "EN8", gross: "0.320", net: "0.210", volume: 24_000, ops: shaft("2.1"), bop: [["BOP-BUSH", "1"]], activeMinutes: 25 },
      ],
    },
    {
      customer: "C", subject: "PTO shaft — 540 rpm", ref: "CC/SCM/26/0822", owner: 2, received: 6, due: -1, stage: "ESTIMATING",
      parts: [{ partNo: "CC-PTO-0540", description: "PTO shaft", material: "MAT-42CRMO4", materialText: "42CrMo4", gross: "6.400", net: "5.100", volume: 18_000, ops: shaft("9.5", [["MC-HOB", "Spline hobbing", "3.2", "60"], ["PR-HT", "Hardening & tempering"], ["MC-GRIND", "Cylindrical grinding", "2.0", "30"]]), activeMinutes: 71 }],
    },
    {
      customer: "D", subject: "Companion flange — 4x2 axle", ref: "DRV/RFQ/26/0431", owner: 3, received: 6, due: 0, stage: "SENT", submitAfter: 2, approveAfter: 1, sendAfter: 1,
      parts: [{ partNo: "DRV-CF-1180", description: "Companion flange", material: "MAT-42CRMO4", materialText: "42CrMo4 forging", gross: "2.900", forged: "2.500", net: "1.950", volume: 48_000, ops: disc("5.6"), tooling: { mode: "SEPARATE", cost: "320000", note: "Forging die set" }, activeMinutes: 49 }],
    },

    // ── decided ──
    {
      customer: "H", subject: "Rear axle — 125 cc", ref: "H/NPD/26/188", owner: 0, received: 14, due: -10, stage: "WON", submitAfter: 2, approveAfter: 1, sendAfter: 1, closeAfterDays: 8,
      parts: [{ partNo: "H-RAX-125", description: "Rear axle", material: "MAT-EN8D", materialText: "EN8D", gross: "0.780", net: "0.600", volume: 210_000, ops: shaft("3.4", [["MC-THREAD-ROLL", "Thread rolling", "0.40", "30"], ["PR-IH", "Induction hardening"]]), activeMinutes: 56 }],
    },
    {
      customer: "B", subject: "Gear shift lever", ref: "CB/PUR/RFQ/26/1057", owner: 4, received: 16, due: -12, stage: "LOST", submitAfter: 3, approveAfter: 1, sendAfter: 1, closeAfterDays: 10, reason: "PRICE",
      note: "Incumbent quoted 6 % lower.",
      parts: [{ partNo: "CB-GSL-0217", description: "Gear shift lever", material: "MAT-C45", materialText: "C45 forging", gross: "0.450", forged: "0.400", net: "0.320", volume: 150_000, ops: arm("2.4", "MC-VMC"), activeMinutes: 49 }],
    },
    {
      customer: "E", subject: "Caliper guide pin", ref: "E/BRK/26/0298", owner: 2, received: 12, due: -6, stage: "LOST", closeAfterDays: 9, reason: "LATE_REPLY",
      note: "Customer placed the order before our quote was ready.",
      parts: [{ partNo: "E-CGP-0071", description: "Caliper guide pin", material: "MAT-C45", materialText: "C45", gross: "0.180", net: "0.120", volume: 420_000, ops: shaft("1.4", [["MC-GRIND", "Cylindrical grinding", "0.6", "30"], ["PR-ZINC", "Zinc plating"]]), activeMinutes: 33 }],
    },
    {
      customer: "F", subject: "Pivot bush — loader arm", ref: "F/LDR/26/112", owner: 5, received: 9, due: -3, stage: "REGRETTED", closeAfterDays: 2, reason: "CAPACITY",
      note: "Needs deep-hole drilling; no capacity this quarter.",
      parts: [{ partNo: "F-PB-0930", description: "Pivot bush", material: "MAT-EN353", materialText: "EN353", gross: "1.600", net: "1.050", volume: 8_000, ops: [], activeMinutes: 9 }],
    },
    ...history(),
  ];
}

/** Two months of sent quotes for the turnaround and win-rate figures. */
function history(): RfqSpec[] {
  const rows: Array<[string, string, number, number, number, Stage, PartSpec, CloseReason?]> = [
    ["C", "Lift arm RH — 45 HP", 1, 22, 4, "WON", { partNo: "CC-HLA-4402", description: "Lift arm RH", material: "MAT-40CR4", materialText: "40Cr4 forging", gross: "4.300", forged: "3.700", net: "3.150", volume: 20_000, ops: arm("10.8"), activeMinutes: 66 }],
    ["D", "Gear blank 38T", 3, 24, 5, "WON", { partNo: "DRV-GB-2150", description: "Gear blank 38T", material: "MAT-20MNCR5", materialText: "20MnCr5", gross: "1.300", forged: "1.140", net: "0.980", volume: 54_000, ops: disc("4.4"), activeMinutes: 61 }],
    ["B", "Front wheel spindle — refresh", 0, 26, 3, "SENT", { partNo: "CB-FWS-0588", description: "Front wheel spindle", material: "MAT-EN8", materialText: "EN8", gross: "0.580", net: "0.450", volume: 200_000, ops: shaft("3.0", [["MC-THREAD-ROLL", "Thread rolling", "0.40", "30"], ["PR-IH", "Induction hardening"]]), activeMinutes: 44 }],
    ["E", "Wheel hub — Tier-1 trailer", 3, 28, 6, "LOST", { partNo: "E-WH-0870", description: "Wheel hub", material: "MAT-40CR4", materialText: "40Cr4 forging", gross: "5.400", forged: "4.600", net: "3.700", volume: 14_000, ops: disc("9.2"), activeMinutes: 88 }, "LEAD_TIME"],
    ["H", "Kick start shaft", 2, 30, 4, "WON", { partNo: "H-KSS-033", description: "Kick start shaft", material: "MAT-EN8D", materialText: "EN8D", gross: "0.360", net: "0.270", volume: 160_000, ops: shaft("2.2", [["MC-HOB", "Spline hobbing", "0.9", "60"]]), activeMinutes: 52 }],
    ["G", "Steering arm", 1, 33, 7, "LOST", { partNo: "G-SA-4410", description: "Steering arm", material: "MAT-42CRMO4", materialText: "42CrMo4 forging", gross: "6.800", forged: "5.900", net: "4.900", volume: 9_000, ops: arm("14.0"), activeMinutes: 97 }, "PRICE"],
    ["C", "Top link pin", 5, 35, 5, "WON", { partNo: "CC-TLP-0219", description: "Top link pin", material: "MAT-C45", materialText: "C45", gross: "0.820", net: "0.640", volume: 30_000, ops: shaft("2.8", [["PR-ZINC", "Zinc plating"]]), activeMinutes: 39 }],
    ["D", "Output flange", 3, 38, 8, "LOST", { partNo: "DRV-OF-1102", description: "Output flange", material: "MAT-42CRMO4", materialText: "42CrMo4 forging", gross: "2.400", forged: "2.050", net: "1.600", volume: 36_000, ops: disc("5.0"), activeMinutes: 74 }, "INCUMBENT_RETAINED"],
    ["B", "Brake cam shaft", 4, 41, 6, "WON", { partNo: "CB-BCS-0390", description: "Brake cam shaft", material: "MAT-EN8", materialText: "EN8", gross: "0.420", net: "0.300", volume: 180_000, ops: shaft("2.5", [["MC-BROACH", "Broaching", "0.5", "45"], ["PR-IH", "Induction hardening"]]), activeMinutes: 68 }],
  ];
  return rows.map(([customer, subject, owner, received, turnaround, stage, part, reason]) => ({
    customer,
    subject,
    ref: `${customer}/RFQ/26/${part.partNo.slice(-4)}`,
    owner,
    received,
    due: -received + 5,
    parts: [part],
    stage,
    submitAfter: Math.max(1, turnaround - 2),
    approveAfter: 1,
    sendAfter: turnaround >= 3 ? 1 : 0,
    closeAfterDays: stage === "SENT" ? undefined : 12,
    reason,
  }));
}

// ─── helpers ───────────────────────────────────────────────────────────────────

/** 10:30 IST on the date `n` working days before today (or after, for negative n). */
function workingDaysAgo(today: IsoDate, n: number, hour = 10.5): Date {
  let date = today;
  let remaining = n;
  while (remaining > 0) {
    date = toIstDate(new Date(new Date(`${date}T12:00:00+05:30`).getTime() - 86_400_000));
    if (new Date(`${date}T12:00:00Z`).getUTCDay() !== 0) remaining -= 1;
  }
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
}

function addWorking(instant: Date, days: number, hour: number): Date {
  const date = addWorkingDays(toIstDate(instant), days);
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
}

function earlier(a: Date, b: Date): Date {
  return a < b ? a : b;
}

// ─── the seed ──────────────────────────────────────────────────────────────────

export interface SeedSummary {
  users: number;
  rateItems: number;
  pastQuotes: number;
  rfqs: number;
  frozenQuotes: number;
}

export async function seedDemo(db: Db, options: { password: string; keepUsers?: boolean; now?: Date } = { password: "" }): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const today = toIstDate(now);

  // 1. Clear application data (TRUNCATE does not fire the append-only row triggers).
  const tables = options.keepUsers ? APP_TABLES : [...APP_TABLES, "Session", "LoginAttempt", "User"];
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);

  // 2. People
  const passwordHash = await hashPassword(options.password);
  const upsertUser = (u: { email: string; name: string; role: "ESTIMATOR" | "SALES_HEAD" }) =>
    db.user.upsert({ where: { email: u.email }, create: { ...u, passwordHash }, update: { name: u.name, role: u.role, active: true } });
  const salesHead = await upsertUser(SEED_USERS.salesHead);
  const estimators = [];
  for (const e of SEED_USERS.estimators) estimators.push(await upsertUser({ ...e, role: "ESTIMATOR" }));

  // 3. Rate masters (historical load: bypasses the add-version invariant, which protects quotes
  //    that do not exist yet)
  const nextMonth = (() => {
    const [y, m] = today.split("-").map(Number) as [number, number];
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();
  let sortOrder = 0;
  for (const item of SEED_ITEMS) {
    await db.rateItem.create({
      data: {
        category: item.category,
        code: item.code,
        name: item.name,
        unit: item.unit,
        attributes: (item.attributes ?? {}) as object,
        sortOrder: sortOrder++,
        versions: {
          create: item.versions.map(([from, value]) => ({
            value,
            effectiveFrom: toDbDate(from === "NEXT" ? nextMonth : from),
            note: from === "NEXT" ? "Mill circular — scheduled increase" : from < "2026-01-01" ? "Loaded from ERP history" : null,
            createdById: salesHead.id,
            createdAt: from === "NEXT" ? now : new Date(`${from === "NEXT" ? today : from}T09:00:00+05:30`),
          })),
        },
      },
    });
  }

  // 4. Customers
  const catalog = await Catalog.load(db);
  const customers = new Map<string, string>();
  for (const c of SEED_CUSTOMERS) {
    const row = await db.customer.create({
      data: {
        code: c.code,
        name: c.name,
        segment: c.segment,
        city: c.city,
        address: c.address,
        emailDomain: c.emailDomain,
        contactName: c.contactName,
        contactEmail: `purchase@${c.emailDomain}`,
        paymentTerms: c.paymentTerms,
        marginBasis: c.marginBasis,
        aiAllowed: c.aiAllowed,
        freightItemId: catalog.byCode.get(c.freight)?.id,
        packingItemId: catalog.byCode.get(c.packing)?.id,
      },
    });
    customers.set(c.key, row.id);
  }

  // 5. The legacy quote register, through the same import as the Import screen (a month ago).
  const register = await readSampleImport("register");
  const imported = await importPastQuotes(db, salesHead, register, { now: workingDaysAgo(today, 26, 15) });

  // 6. RFQs, replayed through the real services
  const specs = scenario().sort((a, b) => b.received - a.received);
  const sequences = new Map<string, number>();
  const reserved = new Set(specs.map((s) => s.number).filter(Boolean));
  let frozen = 0;

  for (const spec of specs) {
    const owner = estimators[spec.owner]!;
    const actor = { id: owner.id, name: owner.name };
    const head = { id: salesHead.id, name: salesHead.name };
    const receivedAt = workingDaysAgo(today, spec.received, 9.5 + (spec.owner % 3));
    const period = toIstDate(receivedAt).slice(2, 4) + toIstDate(receivedAt).slice(5, 7);
    let number = spec.number;
    while (!number) {
      const seq = (sequences.get(period) ?? 0) + 1;
      sequences.set(period, seq);
      const candidate = `RFQ-${period}-${String(seq).padStart(3, "0")}`;
      if (!reserved.has(candidate)) number = candidate;
    }
    const parsed = parseRfqNumber(number)!;
    sequences.set(parsed.period, Math.max(sequences.get(parsed.period) ?? 0, parsed.sequence));

    const created = await db.$transaction(
      (tx) =>
        createRfq(tx, actor, {
          number,
          customerId: customers.get(spec.customer)!,
          customerRef: spec.ref,
          subject: spec.subject,
          receivedAt,
          dueDate: spec.due >= 0 ? addWorkingDays(today, spec.due) : toIstDate(workingDaysAgo(today, -spec.due)),
          ownerId: owner.id,
          now: receivedAt,
          parts: spec.parts.map((p) => ({
            partNo: p.partNo,
            description: p.description,
            drawingNo: p.partNo,
            drawingRev: p.drawingRev ?? "A",
            materialText: p.materialText,
            materialItemId: catalog.byCode.get(p.material)?.id ?? null,
            grossWeightKg: p.gross,
            forgedWeightKg: p.forged ?? null,
            netWeightKg: p.net,
            annualVolume: p.volume,
            processHints: p.ops.filter(([code]) => code.startsWith("PR-")).map(([, name]) => name.toLowerCase()),
          })),
        }),
      { timeout: 60_000 },
    );

    await writeCostings(db, catalog, created.id, spec, receivedAt);
    if (spec.provenance) await writeProvenance(db, created.id, spec.provenance, owner.id, receivedAt);

    // Lifecycle
    const quote = await db.quote.findFirstOrThrow({ where: { rfqId: created.id }, select: { id: true } });
    const close = async (at: Date) => {
      if (spec.stage === "WON" || spec.stage === "LOST" || spec.stage === "REGRETTED") {
        await closeRfq(db, actor, { rfqId: created.id, outcome: spec.stage, reason: spec.reason ?? null, note: spec.note ?? null }, { now: earlier(at, now) });
      }
    };
    if (spec.submitAfter === undefined) {
      if (spec.stage !== "ESTIMATING") await close(new Date(receivedAt.getTime() + (spec.closeAfterDays ?? 3) * 86_400_000));
      continue;
    }

    const submittedAt = earlier(addWorking(receivedAt, spec.submitAfter, 16), new Date(now.getTime() - 3 * 3600_000));
    const { requiresApproval } = await submitQuote(db, actor, quote.id, { now: submittedAt });
    frozen++;
    if (spec.stage === "IN_APPROVAL") continue;

    let approvedAt = submittedAt;
    if (requiresApproval) {
      const snap = await getSnapshotBody(db, quote.id);
      const decidedAt = earlier(addWorking(submittedAt, spec.approveAfter ?? 1, 11.25), new Date(now.getTime() - 2 * 3600_000));
      if (spec.stage === "RETURNED") {
        const partIds = (await db.rfqPart.findMany({ where: { rfqId: created.id }, select: { id: true } })).map((p) => p.id);
        await returnQuote(db, head, { quoteId: quote.id, snapshotId: snap!.id, note: spec.note ?? "Please recheck.", partIds }, { now: decidedAt });
        continue;
      }
      await approveQuote(db, head, { quoteId: quote.id, snapshotId: snap!.id, note: null }, { now: decidedAt });
      approvedAt = decidedAt;
    }
    if (spec.stage === "READY") continue;

    const sentAt = earlier(addWorking(approvedAt, spec.sendAfter ?? 0, 15.5), new Date(now.getTime() - 3600_000));
    const customer = SEED_CUSTOMERS.find((c) => c.key === spec.customer)!;
    await sendQuote(
      db,
      head,
      {
        quoteId: quote.id,
        to: `purchase@${customer.emailDomain}`,
        cc: null,
        subject: `Quotation ${number.replace("RFQ", "QT")}-R0 — ${spec.subject}`,
        message: `Dear Sir/Madam,\n\nPlease find attached our quotation against your RFQ ${spec.ref}.\n\nRegards,\n${head.name}\nCompany A`,
      },
      (id) => renderQuotePdfFor(db, id),
      { now: sentAt },
    );
    if (spec.stage !== "SENT") await close(new Date(sentAt.getTime() + (spec.closeAfterDays ?? 10) * 86_400_000));
  }

  // 7. Move every RFQ counter past the numbers the seed used.
  for (const [period, seq] of sequences) await raiseSequence(db, `RFQ-${period}`, seq);

  return {
    users: estimators.length + 1,
    rateItems: SEED_ITEMS.length,
    pastQuotes: imported.imported,
    rfqs: specs.length,
    frozenQuotes: frozen,
  };
}

/** Writes each part's costing (routing, tiers, tooling) and the estimator time it took. */
async function writeCostings(db: Db, catalog: Catalog, rfqId: string, spec: RfqSpec, receivedAt: Date) {
  const quote = await db.quote.findFirstOrThrow({
    where: { rfqId },
    include: { rfq: { include: { customer: true } }, lines: { include: { rfqPart: true } } },
  });
  const basisDate = toIstDate(receivedAt);
  const options = optionsAt(catalog, basisDate);
  const params = basisParams(catalog, basisDate);

  for (const line of quote.lines) {
    const part = spec.parts[line.rfqPart.lineNo - 1]!;
    const draft: LineDraft = defaultDraft({
      part: {
        grossWeightKg: part.gross,
        forgedWeightKg: part.forged ?? null,
        netWeightKg: part.net,
        annualVolume: part.volume,
        materialItemId: catalog.byCode.get(part.material)?.id ?? null,
        gstClass: line.gstClass,
      },
      customer: quote.rfq.customer,
      params,
    });
    draft.operations = part.ops.map(([code, name, cycle, setup]) => {
      const item = catalog.byCode.get(code)!;
      const option = options.find((o) => o.id === item.id)!;
      const kind = item.unit === "PER_HOUR" ? "MACHINE" : item.unit === "PER_KG" ? "PROCESS_KG" : "PROCESS_PC";
      return {
        id: newRowId(),
        name,
        itemId: item.id,
        kind,
        cycleTimeMin: kind === "MACHINE" ? (cycle ?? null) : null,
        setupMin: kind === "MACHINE" ? (setup ?? "0") : null,
        // A bar-turned part has no forged weight: per-kg processes then charge on gross.
        weightBasis: kind === "PROCESS_KG" ? (option.defaultWeightBasis === "FORGED" && !part.forged ? "GROSS" : (option.defaultWeightBasis ?? "GROSS")) : null,
        suggestedFromId: null,
        legacyName: null,
        confirmed: true,
      } as LineDraft["operations"][number];
    });
    draft.bop = (part.bop ?? []).map(([code, qty]) => ({ id: newRowId(), itemId: catalog.byCode.get(code)!.id, quantity: qty }));
    if (part.margins) draft.tiers = draft.tiers.map((t, i) => ({ ...t, marginPct: part.margins![i] ?? t.marginPct }));
    if (part.tooling) {
      draft.toolingMode = part.tooling.mode;
      draft.toolingCost = part.tooling.cost;
      draft.toolingAmortYears = part.tooling.years ?? null;
      draft.toolingNote = part.tooling.note ?? null;
    }
    const started = new Date(receivedAt.getTime() + 2 * 3600_000);
    await db.$transaction((tx) =>
      writeLine(tx, line.id, draft, options, {
        costingStartedAt: part.activeMinutes ? started : null,
        lastActivityAt: part.activeMinutes ? new Date(started.getTime() + part.activeMinutes * 90_000) : null,
        activeSeconds: (part.activeMinutes ?? 0) * 60,
      }),
    );
  }
}

/** Where the sample RFQs' values came from, as if accepted from the intake review. */
async function writeProvenance(db: Db, rfqId: string, kind: "excel" | "ai", userId: string, receivedAt: Date) {
  const part = await db.rfqPart.findFirstOrThrow({ where: { rfqId }, orderBy: { lineNo: "asc" } });
  const at = new Date(receivedAt.getTime() + 40 * 60_000);
  const rows =
    kind === "excel"
      ? [
          ["partNo", part.partNo, "EXCEL", "Part list CB-RFQ-1182.xlsx", "Sheet1!B4", part.partNo, "HIGH", "COLUMN"],
          ["description", part.description, "EXCEL", "Part list CB-RFQ-1182.xlsx", "Sheet1!C4", part.description, "HIGH", "COLUMN"],
          ["material", part.materialText ?? "", "EXCEL", "Part list CB-RFQ-1182.xlsx", "Sheet1!D4", "EN-8", "MEDIUM", "COLUMN"],
          ["grossWeightKg", String(part.grossWeightKg), "EXCEL", "Part list CB-RFQ-1182.xlsx", "Sheet1!E4", "0.61", "HIGH", "COLUMN"],
          ["annualVolume", String(part.annualVolume), "EXCEL", "Part list CB-RFQ-1182.xlsx", "Sheet1!G4", "1,80,000", "HIGH", "COLUMN"],
        ]
      : [
          ["partNo", part.partNo, "DRAWING_PDF", "Drawing DRV-GB-2207 rev C.pdf", "title block", "PART NO DRV-GB-2207", "HIGH", "AGREED"],
          ["description", part.description, "DRAWING_PDF", "Drawing DRV-GB-2207 rev C.pdf", "title block", "PART NAME GEAR BLANK", "HIGH", "AGREED"],
          ["material", part.materialText ?? "", "EMAIL", "Email from purchase@companyd.example", "line 9", "Material: 20MnCr5 as per drawing", "HIGH", "AGREED"],
          ["grossWeightKg", String(part.grossWeightKg), "EXCEL", "DRV-RFQ-0457 part list.xlsx", "Sheet1!E3", "1.48", "HIGH", "COLUMN"],
          ["netWeightKg", String(part.netWeightKg), "DRAWING_PDF", "Drawing DRV-GB-2207 rev C.pdf", "title block", "FINISH WT 1.12 KG", "MEDIUM", "SINGLE"],
          ["annualVolume", String(part.annualVolume), "EMAIL", "Email from purchase@companyd.example", "line 12", "Annual requirement: 60,000 nos", "HIGH", "SINGLE"],
        ];
  for (const [fieldKey, value, sourceKind, sourceLabel, locator, evidence, confidence, decidedVia] of rows) {
    await db.fieldProvenance.create({
      data: {
        rfqId,
        rfqPartId: part.id,
        fieldKey: fieldKey!,
        value: value!,
        sourceKind: sourceKind as "EXCEL",
        sourceLabel: sourceLabel!,
        locator: locator!,
        evidence: evidence!,
        confidence: confidence as "HIGH",
        decidedVia: decidedVia as "SINGLE",
        acceptedById: userId,
        acceptedAt: at,
      },
    });
  }
}
