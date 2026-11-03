import { createHash } from "node:crypto";
import { toIstDate, type IsoDate } from "@/domain/calendar";
import { evaluateApproval, type ApprovalResult } from "@/domain/costing/approval";
import { contextFromOptions, draftToCostingInput, type LineDraft } from "@/domain/costing/draft";
import { computeCosting } from "@/domain/costing/engine";
import type { CostingInput, CostingResult, MarginBasis, RateRef } from "@/domain/costing/types";
import { formatQuoteNumber } from "@/domain/numbering";
import { COMMERCIAL } from "@/domain/rates/catalog";
import { canonicalJson } from "@/domain/snapshot";
import { inputForm, shapeFamily } from "@/domain/similarity/shape";
import { quoteTransition, rfqTransition, type Action, type CloseReason } from "@/domain/status";
import { formatINR } from "@/lib/format";
import type { Db, DbOrTx } from "@/server/db-client";
import { dateStr } from "@/server/dto";
import { ConflictError, NotFoundError, UserError } from "@/server/errors";
import { recordAudit } from "./audit";
import { basisParams, createDraftQuote, lineToDraft, optionsAt } from "./quotes";
import { Catalog } from "./rates";

/**
 * Submit → approve / return → send → won / lost, and revisions. Every transition is a
 * compare-and-set on status and lockVersion, applied to the quote and its RFQ in one transaction
 * together with the audit row, so concurrent clicks can never both succeed.
 */

export interface SnapshotLine {
  partId: string;
  lineNo: number;
  partNo: string;
  description: string;
  drawingNo: string | null;
  drawingRev: string | null;
  materialText: string | null;
  hsnCode: string | null;
  gstClass: "GST_18" | "GST_5";
  draft: LineDraft;
  input: CostingInput;
  result: CostingResult;
  provenance: Record<string, { value: string; source: string; locator: string | null; decidedVia: string; acceptedBy: string }>;
}

export interface SnapshotBody {
  engineVersion: string;
  quote: {
    id: string;
    number: string;
    revision: number;
    basisDate: IsoDate;
    basisReason: string | null;
    marginBasis: MarginBasis;
    validityDays: number;
    documentDate: IsoDate;
  };
  rfq: { id: string; number: string; subject: string; customerRef: string | null; receivedDate: IsoDate };
  customer: {
    id: string;
    code: string;
    name: string;
    city: string;
    address: string | null;
    contactName: string | null;
    contactEmail: string | null;
    paymentTerms: string;
  };
  preparedBy: { id: string; name: string };
  params: { overheadPct: RateRef | null; iccRatePct: RateRef | null; iccDays: RateRef | null };
  policy: { resolvedOn: IsoDate; threshold: RateRef | null; marginFloor: RateRef | null; gst18: RateRef | null; gst5: RateRef | null };
  lines: SnapshotLine[];
  approval: ApprovalResult;
}

export interface SubmitProblem {
  partId: string | null;
  message: string;
}

export interface StaleRate {
  name: string;
  used: string | null;
  current: string | null;
}

// ─── assembling (live for drafts, frozen on submit) ────────────────────────────

const quoteInclude = {
  rfq: { include: { customer: true, owner: { select: { id: true, name: true } } } },
  lines: {
    include: {
      operations: true,
      tiers: true,
      rfqPart: {
        include: {
          provenances: { include: { acceptedBy: { select: { name: true } } } },
          _count: { select: { extractedFields: { where: { status: "PENDING" as const } } } },
        },
      },
    },
    orderBy: { rfqPart: { lineNo: "asc" as const } },
  },
} as const;

/**
 * Builds the snapshot body for a quote as it stands, plus everything that would block a submit.
 * Policy items (threshold, margin floor, GST) are resolved at `policyDate`; cost rates at the
 * quote's basis date.
 */
export async function assembleQuote(db: DbOrTx, quoteId: string, policyDate: IsoDate) {
  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: quoteInclude });
  if (!quote) throw new NotFoundError("Quote");

  const basisDate = dateStr(quote.basisDate);
  const catalog = await Catalog.load(db);
  const options = optionsAt(catalog, basisDate);
  const params = basisParams(catalog, basisDate);
  const policy = {
    resolvedOn: policyDate,
    threshold: catalog.codeAt(COMMERCIAL.APPROVAL_THRESHOLD, policyDate),
    marginFloor: catalog.codeAt(COMMERCIAL.MARGIN_FLOOR_PCT, policyDate),
    gst18: catalog.codeAt(COMMERCIAL.GST_18, policyDate),
    gst5: catalog.codeAt(COMMERCIAL.GST_5, policyDate),
  };
  const ctx = contextFromOptions(options, {
    overheadPct: params.overheadPct,
    iccRatePct: params.iccRatePct,
    iccDays: params.iccDays,
    marginBasis: quote.marginBasis,
  });

  const problems: SubmitProblem[] = [];
  const stale = new Map<string, StaleRate>();
  const lines: SnapshotLine[] = quote.lines.map((line) => {
    const part = line.rfqPart;
    const label = `Part ${part.lineNo} (${part.description})`;
    const draft = lineToDraft(line, catalog);
    const input = draftToCostingInput(draft, ctx);
    const result = computeCosting(input, { marginFloorPct: policy.marginFloor?.value ?? null });

    // Rates that moved since the line was last saved (a back-dated or voided version).
    const stored: Array<[string | null, RateRef | null]> = [
      [line.materialVersionId, input.material],
      [line.scrapVersionId, input.turningsScrap],
      [line.flashScrapVersionId, input.flashScrap],
      [line.packingVersionId, input.packing],
      [line.freightVersionId, input.freight],
      ...line.operations.map((op) => {
        const resolved = op.kind === "BOP" ? input.bop.find((b) => b.id === op.id)?.rate : input.operations.find((o) => o.id === op.id)?.rate;
        return [op.rateVersionId, resolved ?? null] as [string | null, RateRef | null];
      }),
    ];
    for (const [storedId, current] of stored) {
      if (storedId && current && storedId !== current.versionId) {
        const used = catalog.version(storedId);
        stale.set(storedId, { name: current.name, used: used?.value ?? null, current: current.value });
      }
    }

    const errors = result.issues.filter((i) => i.severity === "error");
    if (errors.length) problems.push({ partId: part.id, message: `${label}: ${errors.map((e) => e.message).join(" ")}` });
    if (part._count.extractedFields > 0) {
      problems.push({ partId: part.id, message: `${label}: ${part._count.extractedFields} value(s) from the RFQ documents still need your decision.` });
    }
    const unconfirmed = draft.operations.filter((o) => !o.confirmed).length;
    if (unconfirmed > 0 || !draft.routingConfirmed) {
      problems.push({ partId: part.id, message: `${label}: confirm the suggested routing (${unconfirmed} operation(s) to check).` });
    }

    return {
      partId: part.id,
      lineNo: part.lineNo,
      partNo: part.partNo,
      description: part.description,
      drawingNo: part.drawingNo,
      drawingRev: part.drawingRev,
      materialText: part.materialText,
      hsnCode: part.hsnCode,
      gstClass: line.gstClass,
      draft,
      input,
      result,
      provenance: Object.fromEntries(
        part.provenances.map((p) => [
          p.fieldKey,
          { value: p.value, source: p.sourceLabel, locator: p.locator, decidedVia: p.decidedVia, acceptedBy: p.acceptedBy.name },
        ]),
      ),
    };
  });

  if (!policy.threshold) problems.push({ partId: null, message: "No approval threshold in the commercial master." });

  const approval = evaluateApproval(
    lines.map((l) => {
      const base = l.result.baseTierIndex === null ? null : l.result.tiers[l.result.baseTierIndex];
      return {
        baseUnitPrice: base?.lines?.unitPrice ?? null,
        baseVolume: base?.volume ?? 0,
        separateTooling: l.draft.toolingMode === "SEPARATE" ? l.draft.toolingCost : "0",
        tierAnnualValues: l.result.tiers.map((t) => t.lines?.annualValue ?? null),
      };
    }),
    policy.threshold?.value ?? "0",
  );

  const rfq = quote.rfq;
  const body: SnapshotBody = {
    engineVersion: lines[0]?.result.engineVersion ?? "",
    quote: {
      id: quote.id,
      number: quote.number,
      revision: quote.revision,
      basisDate,
      basisReason: quote.basisReason,
      marginBasis: quote.marginBasis,
      validityDays: quote.validityDays,
      documentDate: policyDate,
    },
    rfq: { id: rfq.id, number: rfq.number, subject: rfq.subject, customerRef: rfq.customerRef, receivedDate: dateStr(rfq.receivedAt) },
    customer: {
      id: rfq.customer.id,
      code: rfq.customer.code,
      name: rfq.customer.name,
      city: rfq.customer.city,
      address: rfq.customer.address,
      contactName: rfq.customer.contactName,
      contactEmail: rfq.customer.contactEmail,
      paymentTerms: rfq.customer.paymentTerms,
    },
    preparedBy: rfq.owner,
    params: { overheadPct: params.overheadPct, iccRatePct: params.iccRatePct, iccDays: params.iccDays },
    policy,
    lines,
    approval,
  };
  return { quote, body, problems, staleRates: [...stale.values()] };
}

export function hashSnapshot(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── transitions ───────────────────────────────────────────────────────────────

async function transition(
  tx: DbOrTx,
  args: { quoteId: string; rfqId: string; action: Action; quote: { status: string; lockVersion: number }; rfqStatus: string; quoteData?: Record<string, unknown>; rfqData?: Record<string, unknown> },
) {
  const nextQuote = quoteTransition(args.quote.status as never, args.action);
  const nextRfq = rfqTransition(args.rfqStatus as never, args.action);
  if (!nextQuote || !nextRfq) throw new UserError("This action is not possible in the quote's current state. Reload to see the latest.");
  const q = await tx.quote.updateMany({
    where: { id: args.quoteId, status: args.quote.status as never, lockVersion: args.quote.lockVersion },
    data: { status: nextQuote, lockVersion: { increment: 1 }, ...args.quoteData },
  });
  const r = await tx.rfq.updateMany({
    where: { id: args.rfqId, status: args.rfqStatus as never },
    data: { status: nextRfq, ...args.rfqData },
  });
  if (q.count !== 1 || r.count !== 1) throw new ConflictError();
  return { nextQuote, nextRfq };
}

const inr = (v: string) => formatINR(v);

/** Optional clock: services default to now; the seed replays history at past times. */
export type Clock = { now?: Date };

export async function submitQuote(db: Db, user: { id: string; name: string }, quoteId: string, clock: Clock = {}) {
  const now = clock.now ?? new Date();
  const today = toIstDate(now);
  const { quote, body, problems, staleRates } = await assembleQuote(db, quoteId, today);
  if (quote.status !== "DRAFT") throw new UserError("Only a draft quote can be submitted.");
  if (staleRates.length) {
    const list = staleRates.map((s) => `${s.name} ${s.used ?? "—"} → ${s.current ?? "—"}`).join("; ");
    throw new UserError(`Rates changed since this quote was priced (${list}). Re-price, check the numbers, then submit.`);
  }
  if (problems.length) {
    throw new UserError(`Fix ${problems.length} issue${problems.length > 1 ? "s" : ""} before submitting: ${problems.map((p) => p.message).join(" ")}`);
  }

  const text = canonicalJson(body);
  const hash = hashSnapshot(text);
  const { requiresApproval, approvalValue, threshold } = body.approval;
  const action: Action = requiresApproval ? "SUBMIT_FOR_APPROVAL" : "APPROVE_BY_RULE";
  const ruleNote = requiresApproval ? null : `Approved by rule: ${inr(approvalValue)} ≤ ${inr(threshold)}`;

  await db.$transaction(async (tx) => {
    const seq = (await tx.quoteSnapshot.count({ where: { quoteId } })) + 1;
    await tx.quoteSnapshot.create({ data: { quoteId, seq, body: text, hash, engineVersion: body.engineVersion, createdById: user.id, createdAt: now } });
    for (const [key, ref] of [
      [COMMERCIAL.APPROVAL_THRESHOLD, body.policy.threshold],
      [COMMERCIAL.MARGIN_FLOOR_PCT, body.policy.marginFloor],
      [COMMERCIAL.GST_18, body.policy.gst18],
      [COMMERCIAL.GST_5, body.policy.gst5],
    ] as const) {
      if (!ref) continue;
      await tx.quoteParam.upsert({
        where: { quoteId_key: { quoteId, key } },
        create: { quoteId, key, rateVersionId: ref.versionId },
        update: { rateVersionId: ref.versionId },
      });
    }
    await transition(tx, {
      quoteId,
      rfqId: quote.rfqId,
      action,
      quote,
      rfqStatus: quote.rfq.status,
      quoteData: {
        approvalValue,
        requiresApproval,
        submittedById: user.id,
        submittedAt: now,
        returnedPartIds: [],
        decidedById: null,
        decidedAt: requiresApproval ? null : now,
        decisionNote: ruleNote,
      },
    });
    await recordAudit(tx, {
      actorId: user.id,
      rfqId: quote.rfqId,
      quoteId,
      entityType: "Quote",
      entityId: quoteId,
      action: requiresApproval ? "quote.submitted" : "quote.approved_by_rule",
      summary: requiresApproval
        ? `${user.name} submitted ${quote.number} for approval (${inr(approvalValue)} > ${inr(threshold)})`
        : `${quote.number} approved by rule (${inr(approvalValue)} ≤ ${inr(threshold)}) — ready to send`,
      data: { snapshotSeq: seq, hash },
      at: now,
    });
  });
  return { requiresApproval, approvalValue };
}

async function latestSnapshot(db: DbOrTx, quoteId: string) {
  return db.quoteSnapshot.findFirst({ where: { quoteId }, orderBy: { seq: "desc" } });
}

async function loadForDecision(db: DbOrTx, quoteId: string, snapshotId: string) {
  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: { rfq: { select: { status: true } } } });
  if (!quote) throw new NotFoundError("Quote");
  const snapshot = await latestSnapshot(db, quoteId);
  if (!snapshot || snapshot.id !== snapshotId) {
    throw new ConflictError("The quote changed after you opened it. Reload and review the latest numbers.");
  }
  return quote;
}

export async function approveQuote(
  db: Db,
  user: { id: string; name: string },
  args: { quoteId: string; snapshotId: string; note: string | null },
  clock: Clock = {},
) {
  const now = clock.now ?? new Date();
  const quote = await loadForDecision(db, args.quoteId, args.snapshotId);
  await db.$transaction(async (tx) => {
    await transition(tx, {
      quoteId: quote.id,
      rfqId: quote.rfqId,
      action: "APPROVE",
      quote,
      rfqStatus: quote.rfq.status,
      quoteData: { decidedById: user.id, decidedAt: now, decisionNote: args.note?.trim() || null },
    });
    await recordAudit(tx, {
      actorId: user.id,
      rfqId: quote.rfqId,
      quoteId: quote.id,
      entityType: "Quote",
      entityId: quote.id,
      action: "quote.approved",
      summary: `${user.name} approved ${quote.number}${args.note?.trim() ? ` — “${args.note.trim()}”` : ""}`,
      data: { snapshotId: args.snapshotId },
      at: now,
    });
  });
}

export async function returnQuote(
  db: Db,
  user: { id: string; name: string },
  args: { quoteId: string; snapshotId: string; note: string; partIds: string[] },
  clock: Clock = {},
) {
  const now = clock.now ?? new Date();
  const note = args.note.trim();
  if (note.length < 5) throw new UserError("Say what needs to change — the estimator sees this note.", { note: "Required" });
  const quote = await loadForDecision(db, args.quoteId, args.snapshotId);
  await db.$transaction(async (tx) => {
    await transition(tx, {
      quoteId: quote.id,
      rfqId: quote.rfqId,
      action: "RETURN",
      quote,
      rfqStatus: quote.rfq.status,
      quoteData: { decidedById: user.id, decidedAt: now, decisionNote: note, returnedPartIds: args.partIds },
    });
    await recordAudit(tx, {
      actorId: user.id,
      rfqId: quote.rfqId,
      quoteId: quote.id,
      entityType: "Quote",
      entityId: quote.id,
      action: "quote.returned",
      summary: `${user.name} returned ${quote.number} — “${note}”`,
      data: { snapshotId: args.snapshotId, partIds: args.partIds },
      at: now,
    });
  });
}

export async function getSnapshotBody(db: DbOrTx, quoteId: string): Promise<{ id: string; hash: string; body: SnapshotBody } | null> {
  const snapshot = await latestSnapshot(db, quoteId);
  return snapshot ? { id: snapshot.id, hash: snapshot.hash, body: JSON.parse(snapshot.body) as SnapshotBody } : null;
}

/** Routing as one line for the past-quote register: "CNC turning 3.2 | Thread rolling 0.4 | …". */
function routingText(line: SnapshotLine): string {
  return line.input.operations
    .map((op) => (op.kind === "MACHINE" && op.cycleTimeMin ? `${op.name} ${Number(op.cycleTimeMin)}` : op.name))
    .join(" | ");
}

export async function sendQuote(
  db: Db,
  user: { id: string; name: string },
  args: { quoteId: string; to: string; cc: string | null; subject: string; message: string },
  renderPdf: (quoteId: string) => Promise<Buffer>,
  clock: Clock = {},
) {
  const quote = await db.quote.findUnique({ where: { id: args.quoteId }, include: { rfq: { select: { status: true, number: true } } } });
  if (!quote) throw new NotFoundError("Quote");
  if (quote.status !== "APPROVED") throw new UserError("Only an approved quote can be sent.");
  const snapshot = await getSnapshotBody(db, quote.id);
  if (!snapshot) throw new UserError("This quote has no frozen snapshot to send.");

  const pdf = await renderPdf(quote.id);
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const now = clock.now ?? new Date();

  await db.$transaction(async (tx) => {
    const file = await tx.storedFile.create({
      data: {
        rfqId: quote.rfqId,
        kind: "QUOTE_PDF",
        filename: `${quote.number}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: pdf.byteLength,
        sha256,
        data: new Uint8Array(pdf),
        uploadedById: user.id,
        createdAt: now,
      },
      select: { id: true },
    });
    await tx.outboxMessage.create({
      data: { quoteId: quote.id, to: args.to, cc: args.cc, subject: args.subject, body: args.message, pdfFileId: file.id, createdById: user.id, createdAt: now },
    });
    await transition(tx, {
      quoteId: quote.id,
      rfqId: quote.rfqId,
      action: "SEND",
      quote,
      rfqStatus: quote.rfq.status,
      quoteData: { sentById: user.id, sentAt: now, sentTo: args.to },
    });
    await tx.quote.updateMany({ where: { rfqId: quote.rfqId, status: "SENT", id: { not: quote.id } }, data: { status: "SUPERSEDED" } });

    // The sent quote becomes searchable history for the next similar RFQ.
    for (const line of snapshot.body.lines) {
      const lineRow = await tx.quoteLine.findFirst({ where: { quoteId: quote.id, rfqPartId: line.partId }, select: { id: true } });
      const base = line.result.baseTierIndex === null ? null : line.result.tiers[line.result.baseTierIndex];
      if (!lineRow || !base?.lines) continue;
      await tx.pastQuote.upsert({
        where: { quoteLineId: lineRow.id },
        create: {
          source: "APP",
          refNo: quote.number,
          quoteDate: new Date(`${snapshot.body.quote.documentDate}T00:00:00Z`),
          customerName: snapshot.body.customer.name,
          customerId: snapshot.body.customer.id,
          partNo: line.partNo,
          description: line.description,
          materialText: line.materialText ?? line.input.material?.name ?? null,
          materialItemId: line.input.material?.itemId ?? null,
          inputForm: inputForm({ materialText: line.materialText, description: line.description, hasForgedWeight: Boolean(line.input.forgedWeightKg) }),
          shapeFamily: shapeFamily(line.description),
          grossWeightKg: line.input.grossWeightKg,
          netWeightKg: line.input.netWeightKg,
          annualVolume: base.volume,
          unitPrice: base.lines.unitPrice,
          outcome: "OPEN",
          estimatorName: snapshot.body.preparedBy.name,
          routingText: routingText(line),
          routingOps: line.draft.operations.map((op) => ({ name: op.name, itemId: op.itemId, kind: op.kind, cycleTimeMin: op.cycleTimeMin, setupMin: op.setupMin, weightBasis: op.weightBasis })),
          quoteLineId: lineRow.id,
          searchText: [line.partNo, line.description, line.materialText, snapshot.body.customer.name].filter(Boolean).join(" · ").toLowerCase(),
        },
        update: { unitPrice: base.lines.unitPrice, annualVolume: base.volume, outcome: "OPEN" },
      });
    }

    await recordAudit(tx, {
      actorId: user.id,
      rfqId: quote.rfqId,
      quoteId: quote.id,
      entityType: "Quote",
      entityId: quote.id,
      action: "quote.sent",
      summary: `${user.name} sent ${quote.number} to ${args.to} (mock email, PDF stored)`,
      data: { fileId: file.id, sha256 },
      at: now,
    });
  });
}

/** Re-opens a sent RFQ with a new draft revision copied from the sent one (re-priced on today). */
export async function reviseRfq(db: Db, user: { id: string; name: string }, rfqId: string, clock: Clock = {}) {
  const now = clock.now ?? new Date();
  const rfq = await db.rfq.findUnique({ where: { id: rfqId }, include: { quotes: { orderBy: { revision: "desc" }, take: 1 } } });
  if (!rfq) throw new NotFoundError("RFQ");
  const latest = rfq.quotes[0];
  if (rfq.status !== "SENT" || !latest || latest.status !== "SENT") throw new UserError("Only a sent quote can be revised.");
  await db.$transaction(async (tx) => {
    const r = await tx.rfq.updateMany({ where: { id: rfqId, status: "SENT" }, data: { status: "ESTIMATING" } });
    if (r.count !== 1) throw new ConflictError();
    const revision = latest.revision + 1;
    const number = formatQuoteNumber(rfq.number, revision);
    await createDraftQuote(tx, { rfqId, revision, number, basisDate: toIstDate(now), copyFrom: latest.id });
    await recordAudit(tx, {
      actorId: user.id,
      rfqId,
      entityType: "Rfq",
      entityId: rfqId,
      action: "quote.revised",
      summary: `${user.name} started revision ${number} from ${latest.number}`,
      at: now,
    });
  });
}

export async function closeRfq(
  db: Db,
  user: { id: string; name: string },
  args: { rfqId: string; outcome: "WON" | "LOST" | "REGRETTED"; reason: CloseReason | null; note: string | null },
  clock: Clock = {},
) {
  const now = clock.now ?? new Date();
  const rfq = await db.rfq.findUnique({ where: { id: args.rfqId } });
  if (!rfq) throw new NotFoundError("RFQ");
  const action: Action = args.outcome === "WON" ? "MARK_WON" : args.outcome === "LOST" ? "MARK_LOST" : "REGRET";
  const next = rfqTransition(rfq.status, action);
  if (!next) throw new UserError(`An RFQ that is ${rfq.status.toLowerCase().replace("_", " ")} cannot be marked ${args.outcome.toLowerCase()}.`);
  if (args.outcome !== "WON" && !args.reason) throw new UserError("Choose a reason.", { reason: "Required" });

  await db.$transaction(async (tx) => {
    const r = await tx.rfq.updateMany({
      where: { id: rfq.id, status: rfq.status },
      data: { status: next, closeReason: args.outcome === "WON" ? null : args.reason, closeNote: args.note?.trim() || null, closedAt: now },
    });
    if (r.count !== 1) throw new ConflictError();
    await tx.pastQuote.updateMany({
      where: { source: "APP", quoteLine: { quote: { rfqId: rfq.id, status: "SENT" } } },
      data: { outcome: args.outcome === "WON" ? "WON" : args.outcome === "LOST" ? "LOST" : "REGRETTED", lostReason: args.reason },
    });
    await recordAudit(tx, {
      actorId: user.id,
      rfqId: rfq.id,
      entityType: "Rfq",
      entityId: rfq.id,
      action: `rfq.${args.outcome.toLowerCase()}`,
      summary: `${user.name} marked ${rfq.number} ${args.outcome.toLowerCase()}${args.reason ? ` (${args.reason.toLowerCase().replace(/_/g, " ")})` : ""}`,
      data: { note: args.note },
      at: now,
    });
  });
}

