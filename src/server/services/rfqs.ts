import { addWorkingDays, dueState, todayIst, toDbDate, toIstDate, workingDaysBetween, type DueState, type IsoDate } from "@/domain/calendar";
import { formatQuoteNumber } from "@/domain/numbering";
import { RFQ_STATUS_LABEL, type RfqStatus } from "@/domain/status";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, DbOrTx } from "@/server/db-client";
import { dateStr, isoStr, moneyStr } from "@/server/dto";
import { NotFoundError, UserError } from "@/server/errors";
import { recordAudit } from "./audit";
import { nextRfqNumber } from "./counters";
import { assembleQuote, getSnapshotBody, type SnapshotBody } from "./quote-lifecycle";
import { createDraftQuote, previewReprice, type RepricePreview } from "./quotes";

const OPEN: RfqStatus[] = ["ESTIMATING", "IN_APPROVAL", "APPROVED", "SENT"];
/** Still with Company A — a sent quote waits on the customer and cannot be late. */
const IN_HAND: RfqStatus[] = ["ESTIMATING", "IN_APPROVAL", "APPROVED"];
const CLOSED: RfqStatus[] = ["WON", "LOST", "REGRETTED"];

// ─── register ──────────────────────────────────────────────────────────────────

export type RegisterView = "mine" | "open" | "approval" | "ready" | "closed" | "all";
export type RegisterChip = "overdue" | "due-soon" | "returned";

export interface RegisterRow {
  id: string;
  number: string;
  customerName: string;
  subject: string;
  partsCount: number;
  firstPart: string | null;
  owner: { id: string; name: string };
  receivedAt: string;
  dueDate: IsoDate;
  due: DueState | null;
  status: RfqStatus;
  statusLabel: string;
  returned: boolean;
  approvalValue: string | null;
  quoteNumber: string | null;
}

function viewWhere(view: RegisterView, userId: string): Prisma.RfqWhereInput {
  switch (view) {
    case "mine":
      return { ownerId: userId, status: { in: OPEN } };
    case "open":
      return { status: { in: OPEN } };
    case "approval":
      return { status: "IN_APPROVAL" };
    case "ready":
      return { status: "APPROVED" };
    case "closed":
      return { status: { in: CLOSED } };
    case "all":
      return {};
  }
}

const returnedWhere: Prisma.RfqWhereInput = {
  status: "ESTIMATING",
  quotes: { some: { status: "DRAFT", decidedAt: { not: null }, decisionNote: { not: null } } },
};

function chipWhere(chip: RegisterChip | undefined, today: IsoDate): Prisma.RfqWhereInput {
  if (chip === "overdue") return { status: { in: IN_HAND }, dueDate: { lt: toDbDate(today) } };
  if (chip === "due-soon") {
    // Due today or within the next 2 working days (Sundays skipped).
    const end = addWorkingDays(today, 2);
    return { status: { in: IN_HAND }, dueDate: { gte: toDbDate(today), lte: toDbDate(end) } };
  }
  if (chip === "returned") return returnedWhere;
  return {};
}

function searchWhere(q: string | undefined): Prisma.RfqWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { number: contains },
      { subject: contains },
      { customerRef: contains },
      { customer: { name: contains } },
      { parts: { some: { OR: [{ partNo: contains }, { description: contains }] } } },
    ],
  };
}

export async function listRegister(
  db: DbOrTx,
  user: { id: string },
  filters: { view: RegisterView; chip?: RegisterChip; q?: string; ownerId?: string; customerId?: string },
) {
  const today = todayIst();
  const base: Prisma.RfqWhereInput = {
    AND: [
      viewWhere(filters.view, user.id),
      searchWhere(filters.q),
      filters.ownerId ? { ownerId: filters.ownerId } : {},
      filters.customerId ? { customerId: filters.customerId } : {},
    ],
  };
  const where: Prisma.RfqWhereInput = { AND: [base, chipWhere(filters.chip, today)] };

  const [rfqs, overdue, dueSoon, returned] = await Promise.all([
    db.rfq.findMany({
      where,
      orderBy: filters.view === "closed" ? [{ closedAt: "desc" }] : filters.view === "all" ? [{ receivedAt: "desc" }] : [{ dueDate: "asc" }, { number: "asc" }],
      take: 200,
      include: {
        customer: { select: { name: true } },
        owner: { select: { id: true, name: true } },
        parts: { select: { description: true }, orderBy: { lineNo: "asc" } },
        quotes: {
          orderBy: { revision: "desc" },
          take: 1,
          select: { number: true, status: true, approvalValue: true, decidedAt: true, decisionNote: true },
        },
      },
    }),
    db.rfq.count({ where: { AND: [base, chipWhere("overdue", today)] } }),
    db.rfq.count({ where: { AND: [base, chipWhere("due-soon", today)] } }),
    db.rfq.count({ where: { AND: [base, chipWhere("returned", today)] } }),
  ]);

  const rows: RegisterRow[] = rfqs.map((r) => {
    const quote = r.quotes[0];
    const dueDate = dateStr(r.dueDate);
    return {
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      subject: r.subject,
      partsCount: r.parts.length,
      firstPart: r.parts[0]?.description ?? null,
      owner: r.owner,
      receivedAt: isoStr(r.receivedAt),
      dueDate,
      due: IN_HAND.includes(r.status) ? dueState(dueDate, today) : null,
      status: r.status,
      statusLabel: RFQ_STATUS_LABEL[r.status],
      returned: r.status === "ESTIMATING" && quote?.status === "DRAFT" && Boolean(quote.decidedAt && quote.decisionNote),
      approvalValue: quote && quote.status !== "DRAFT" ? moneyStr(quote.approvalValue) : null,
      quoteNumber: quote?.number ?? null,
    };
  });
  // Work in hand first (soonest due), then quotes waiting on the customer.
  if (filters.view === "mine" || filters.view === "open") {
    rows.sort((a, b) => Number(a.status === "SENT") - Number(b.status === "SENT") || a.dueDate.localeCompare(b.dueDate));
  }
  return { rows, chips: { overdue, "due-soon": dueSoon, returned } satisfies Record<RegisterChip, number> };
}

export async function registerViewCounts(db: DbOrTx, user: { id: string }) {
  const [mine, open, approval, ready, review] = await Promise.all([
    db.rfq.count({ where: viewWhere("mine", user.id) }),
    db.rfq.count({ where: viewWhere("open", user.id) }),
    db.rfq.count({ where: viewWhere("approval", user.id) }),
    db.rfq.count({ where: viewWhere("ready", user.id) }),
    db.intakeSession.count({ where: { status: "REVIEW" } }),
  ]);
  return { mine, open, approval, ready, review };
}

/** One-line performance read-out for the sales head, against the brief's success metrics. */
export async function salesHeadKpis(db: DbOrTx) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since90 = new Date(Date.now() - 90 * 86_400_000);
  const since365 = new Date(Date.now() - 365 * 86_400_000);
  const [sent, closed, lines, lateLost] = await Promise.all([
    db.quote.findMany({ where: { sentAt: { gte: since30 }, revision: 0 }, select: { sentAt: true, rfq: { select: { receivedAt: true } } } }),
    db.rfq.groupBy({ by: ["status"], where: { status: { in: ["WON", "LOST"] }, closedAt: { gte: since90 } }, _count: true }),
    db.quoteLine.findMany({ where: { quote: { submittedAt: { gte: since30 } }, activeSeconds: { gt: 0 } }, select: { activeSeconds: true } }),
    db.rfq.findMany({ where: { status: "LOST", closeReason: "LATE_REPLY", closedAt: { gte: since365 } }, select: { quotes: { select: { approvalValue: true }, orderBy: { revision: "desc" }, take: 1 } } }),
  ]);
  const turnarounds = sent.map((q) => workingDaysBetween(toIstDate(q.rfq.receivedAt), toIstDate(q.sentAt!)));
  const avg = turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : null;
  const won = closed.find((c) => c.status === "WON")?._count ?? 0;
  const lost = closed.find((c) => c.status === "LOST")?._count ?? 0;
  const minutes = lines.map((l) => l.activeSeconds / 60).sort((a, b) => a - b);
  const median = minutes.length ? minutes[Math.floor(minutes.length / 2)]! : null;
  return {
    avgTurnaroundDays: avg === null ? null : Math.round(avg * 10) / 10,
    turnaroundSample: turnarounds.length,
    winRatePct: won + lost ? Math.round((won / (won + lost)) * 100) : null,
    medianMinutesPerPart: median === null ? null : Math.round(median),
    lateReplyLost: lateLost.length,
    lateReplyValue: lateLost.reduce((acc, r) => acc + Number(r.quotes[0]?.approvalValue ?? 0), 0).toFixed(2),
  };
}

// ─── workspace ─────────────────────────────────────────────────────────────────

export interface WorkspacePart {
  id: string;
  lineNo: number;
  partNo: string;
  description: string;
  materialText: string | null;
  annualVolume: number | null;
  pendingReview: number;
  /** Per-tier unit prices (null = withheld) and issue counts for the overview matrix. */
  tiers: Array<{ volume: number; isBase: boolean; unitPrice: string | null; annualValue: string | null }>;
  errors: number;
  warnings: number;
}

export async function getWorkspace(db: DbOrTx, rfqId: string) {
  const rfq = await db.rfq.findUnique({
    where: { id: rfqId },
    include: {
      customer: true,
      owner: { select: { id: true, name: true } },
      parts: { orderBy: { lineNo: "asc" }, include: { _count: { select: { extractedFields: { where: { status: "PENDING" } } } } } },
      quotes: {
        orderBy: { revision: "desc" },
        include: {
          submittedBy: { select: { name: true } },
          decidedBy: { select: { name: true } },
          sentBy: { select: { name: true } },
          snapshots: { orderBy: { seq: "desc" }, take: 1, select: { id: true, hash: true, seq: true } },
        },
      },
    },
  });
  if (!rfq) throw new NotFoundError("RFQ");
  const quote = rfq.quotes[0] ?? null;
  const today = todayIst();

  // Figures: live for a draft, the frozen snapshot otherwise.
  let body: SnapshotBody | null = null;
  let problems: Array<{ partId: string | null; message: string }> = [];
  let staleRates: Array<{ name: string; used: string | null; current: string | null }> = [];
  let newerRates: RepricePreview | null = null;
  if (quote && quote.status === "DRAFT") {
    const assembled = await assembleQuote(db, quote.id, today);
    body = assembled.body;
    problems = assembled.problems;
    staleRates = assembled.staleRates;
    // Rates that changed between the basis date and today (re-pricing would move the price).
    if (dateStr(quote.basisDate) !== today) {
      const preview = await previewReprice(db, quote.id, today);
      if (preview.changedRates.length) newerRates = preview;
    }
  } else if (quote) {
    body = (await getSnapshotBody(db, quote.id))?.body ?? null;
  }

  const parts: WorkspacePart[] = rfq.parts.map((p) => {
    const line = body?.lines.find((l) => l.partId === p.id);
    return {
      id: p.id,
      lineNo: p.lineNo,
      partNo: p.partNo,
      description: p.description,
      materialText: p.materialText,
      annualVolume: p.annualVolume,
      pendingReview: p._count.extractedFields,
      tiers: line ? line.result.tiers.map((t) => ({ volume: t.volume, isBase: t.isBase, unitPrice: t.lines?.unitPrice ?? null, annualValue: t.lines?.annualValue ?? null })) : [],
      errors: line?.result.issues.filter((i) => i.severity === "error").length ?? 0,
      warnings: line?.result.issues.filter((i) => i.severity === "warning").length ?? 0,
    };
  });

  const dueDate = dateStr(rfq.dueDate);
  return {
    id: rfq.id,
    number: rfq.number,
    status: rfq.status,
    statusLabel: RFQ_STATUS_LABEL[rfq.status],
    closeReason: rfq.closeReason,
    closeNote: rfq.closeNote,
    subject: rfq.subject,
    customerRef: rfq.customerRef,
    customer: { id: rfq.customer.id, name: rfq.customer.name, city: rfq.customer.city, segment: rfq.customer.segment, contactEmail: rfq.customer.contactEmail, aiAllowed: rfq.customer.aiAllowed, marginBasis: rfq.customer.marginBasis },
    receivedAt: isoStr(rfq.receivedAt),
    dueDate,
    due: IN_HAND.includes(rfq.status) ? dueState(dueDate, today) : null,
    owner: rfq.owner,
    parts,
    approval: body?.approval ?? null,
    problems,
    staleRates,
    newerRates,
    quote: quote
      ? {
          id: quote.id,
          number: quote.number,
          revision: quote.revision,
          status: quote.status,
          basisDate: dateStr(quote.basisDate),
          basisReason: quote.basisReason,
          marginBasis: quote.marginBasis,
          approvalValue: moneyStr(quote.approvalValue),
          requiresApproval: quote.requiresApproval,
          decisionNote: quote.decisionNote,
          returnedPartIds: quote.returnedPartIds,
          submittedBy: quote.submittedBy?.name ?? null,
          submittedAt: isoStr(quote.submittedAt),
          decidedBy: quote.decidedBy?.name ?? null,
          decidedAt: isoStr(quote.decidedAt),
          sentBy: quote.sentBy?.name ?? null,
          sentAt: isoStr(quote.sentAt),
          sentTo: quote.sentTo,
          snapshot: quote.snapshots[0] ?? null,
        }
      : null,
    revisions: rfq.quotes.map((q) => ({ id: q.id, number: q.number, status: q.status, sentAt: isoStr(q.sentAt) })),
  };
}
export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;

export async function getRfqActivity(db: DbOrTx, rfqId: string) {
  const events = await db.auditEvent.findMany({
    where: { rfqId },
    orderBy: { at: "desc" },
    take: 200,
    include: { actor: { select: { name: true } } },
  });
  return events.map((e) => ({ id: e.id, at: isoStr(e.at), actor: e.actor?.name ?? "System", action: e.action, summary: e.summary }));
}

export async function getRfqFiles(db: DbOrTx, rfqId: string) {
  const files = await db.storedFile.findMany({
    where: { rfqId },
    orderBy: { createdAt: "asc" },
    include: {
      uploadedBy: { select: { name: true } },
      accesses: { orderBy: { at: "desc" }, take: 5, include: { user: { select: { name: true } } } },
      _count: { select: { accesses: true } },
    },
  });
  return files.map((f) => ({
    id: f.id,
    kind: f.kind,
    filename: f.filename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    uploadedBy: f.uploadedBy.name,
    createdAt: isoStr(f.createdAt),
    accessCount: f._count.accesses,
    recentAccess: f.accesses.map((a) => ({ user: a.user.name, action: a.action, at: isoStr(a.at) })),
  }));
}

// ─── creating ──────────────────────────────────────────────────────────────────

export interface NewPart {
  partNo: string;
  description: string;
  drawingNo?: string | null;
  drawingRev?: string | null;
  materialText?: string | null;
  materialItemId?: string | null;
  grossWeightKg?: string | null;
  forgedWeightKg?: string | null;
  netWeightKg?: string | null;
  annualVolume?: number | null;
  heatTreatment?: string | null;
  surfaceTreatment?: string | null;
  processHints?: string[];
  gstClass?: "GST_18" | "GST_5";
  hsnCode?: string | null;
}

/**
 * Creates an RFQ with its parts and draft quote (R0) in one transaction. The register number is
 * allocated atomically from the India date the RFQ was received; `number` overrides it for seeding.
 */
export async function createRfq(
  tx: DbOrTx,
  user: { id: string; name: string },
  input: {
    customerId: string;
    customerRef: string | null;
    subject: string;
    receivedAt: Date;
    dueDate: IsoDate;
    ownerId: string;
    parts: NewPart[];
    number?: string;
    basisDate?: IsoDate;
    /** Defaults to now; the seed replays history at past times. */
    now?: Date;
  },
): Promise<{ id: string; number: string; partIds: string[] }> {
  if (input.parts.length === 0) throw new UserError("An RFQ needs at least one part.");
  const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { segment: true, name: true } });
  if (!customer) throw new NotFoundError("Customer");

  const number = input.number ?? (await nextRfqNumber(tx, toIstDate(input.receivedAt)));
  const rfq = await tx.rfq.create({
    data: {
      number,
      customerId: input.customerId,
      customerRef: input.customerRef,
      subject: input.subject,
      receivedAt: input.receivedAt,
      dueDate: toDbDate(input.dueDate),
      ownerId: input.ownerId,
      createdById: user.id,
      ...(input.now ? { createdAt: input.now } : {}),
      parts: {
        create: input.parts.map((p, i) => ({
          lineNo: i + 1,
          partNo: p.partNo,
          description: p.description,
          drawingNo: p.drawingNo ?? null,
          drawingRev: p.drawingRev ?? null,
          materialText: p.materialText ?? null,
          materialItemId: p.materialItemId ?? null,
          grossWeightKg: p.grossWeightKg ?? null,
          forgedWeightKg: p.forgedWeightKg ?? null,
          netWeightKg: p.netWeightKg ?? null,
          annualVolume: p.annualVolume ?? null,
          heatTreatment: p.heatTreatment ?? null,
          surfaceTreatment: p.surfaceTreatment ?? null,
          processHints: p.processHints ?? [],
          // Specified tractor parts default to 5 % GST (A-8); the estimator can change it.
          gstClass: p.gstClass ?? (customer.segment === "TRACTOR" ? "GST_5" : "GST_18"),
          hsnCode: p.hsnCode ?? null,
        })),
      },
    },
    include: { parts: { select: { id: true }, orderBy: { lineNo: "asc" } } },
  });
  await createDraftQuote(tx, { rfqId: rfq.id, revision: 0, number: formatQuoteNumber(number, 0), basisDate: input.basisDate ?? (input.now ? toIstDate(input.now) : todayIst()) });
  await recordAudit(tx, {
    actorId: user.id,
    rfqId: rfq.id,
    entityType: "Rfq",
    entityId: rfq.id,
    action: "rfq.created",
    summary: `${user.name} registered ${number} from ${customer.name} (${input.parts.length} part${input.parts.length > 1 ? "s" : ""})`,
    at: input.now,
  });
  return { id: rfq.id, number, partIds: rfq.parts.map((p) => p.id) };
}

export async function reassignRfq(db: Db, user: { id: string; name: string }, args: { rfqId: string; ownerId: string }) {
  const owner = await db.user.findFirst({ where: { id: args.ownerId, role: "ESTIMATOR", active: true }, select: { name: true } });
  if (!owner) throw new UserError("Choose an active estimator.");
  await db.$transaction(async (tx) => {
    const rfq = await tx.rfq.update({ where: { id: args.rfqId }, data: { ownerId: args.ownerId }, select: { number: true } });
    await recordAudit(tx, { actorId: user.id, rfqId: args.rfqId, entityType: "Rfq", entityId: args.rfqId, action: "rfq.reassigned", summary: `${user.name} assigned ${rfq.number} to ${owner.name}` });
  });
}

export async function listEstimators(db: DbOrTx) {
  return db.user.findMany({ where: { role: "ESTIMATOR", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function listCustomers(db: DbOrTx) {
  return db.customer.findMany({ select: { id: true, name: true, segment: true }, orderBy: { name: "asc" } });
}

