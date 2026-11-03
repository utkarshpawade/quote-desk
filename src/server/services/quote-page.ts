import { todayIst, toIstDate } from "@/domain/calendar";
import type { ApprovalResult } from "@/domain/costing/approval";
import type { QuoteDocument } from "@/domain/quote-document";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/domain/status";
import type { DbOrTx } from "@/server/db-client";
import { dateStr, isoStr } from "@/server/dto";
import { NotFoundError } from "@/server/errors";
import { assembleQuote, getSnapshotBody, type SnapshotBody } from "./quote-lifecycle";
import { quoteDocumentFor } from "./quote-pdf";

export interface ApprovalPartSummary {
  partId: string;
  lineNo: number;
  description: string;
  partNo: string;
  baseVolume: number | null;
  baseUnitPrice: string | null;
  pricePerKg: string | null;
  lowestMarginPct: string | null;
  belowFloor: boolean;
  warnings: string[];
  provenance: { total: number; byVia: Record<string, number>; edited: number; acceptedBy: string[] };
}

/** Everything the quote page shows: the customer document plus the approver's internal view. */
export async function getQuotePage(db: DbOrTx, quoteId: string) {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: {
      rfq: { select: { id: true, number: true, subject: true, status: true, customer: { select: { name: true, contactEmail: true } }, owner: { select: { name: true } } } },
      submittedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      sentBy: { select: { name: true } },
      snapshots: { orderBy: { seq: "desc" }, take: 1, select: { id: true, hash: true, seq: true, createdAt: true } },
      outbox: { orderBy: { createdAt: "desc" }, select: { id: true, to: true, cc: true, subject: true, body: true, createdAt: true, pdfFileId: true } },
    },
  });
  if (!quote) throw new NotFoundError("Quote");

  let body: SnapshotBody;
  let problems: Array<{ partId: string | null; message: string }> = [];
  if (quote.status === "DRAFT") {
    const assembled = await assembleQuote(db, quote.id, todayIst());
    body = assembled.body;
    problems = assembled.problems;
  } else {
    const snap = await getSnapshotBody(db, quote.id);
    if (!snap) throw new NotFoundError("Quote snapshot");
    body = snap.body;
  }
  const document: QuoteDocument = await quoteDocumentFor(db, quote.id);
  const floor = body.policy.marginFloor?.value ?? null;

  const parts: ApprovalPartSummary[] = body.lines.map((line) => {
    const base = line.result.baseTierIndex === null ? null : line.result.tiers[line.result.baseTierIndex];
    const margins = line.result.tiers.map((t) => Number(t.marginPct));
    const lowest = margins.length ? Math.min(...margins) : null;
    const prov = Object.values(line.provenance);
    const byVia: Record<string, number> = {};
    for (const p of prov) byVia[p.decidedVia] = (byVia[p.decidedVia] ?? 0) + 1;
    return {
      partId: line.partId,
      lineNo: line.lineNo,
      description: line.description,
      partNo: line.partNo,
      baseVolume: base?.volume ?? null,
      baseUnitPrice: base?.lines?.unitPrice ?? null,
      pricePerKg: base?.lines?.pricePerKg ?? null,
      lowestMarginPct: lowest === null ? null : String(lowest),
      belowFloor: lowest !== null && floor !== null && lowest < Number(floor),
      warnings: line.result.issues.filter((i) => i.severity === "warning").map((i) => i.message),
      provenance: { total: prov.length, byVia, edited: byVia.EDITED ?? 0, acceptedBy: [...new Set(prov.map((p) => p.acceptedBy))] },
    };
  });

  return {
    id: quote.id,
    number: quote.number,
    revision: quote.revision,
    status: quote.status as QuoteStatus,
    statusLabel: QUOTE_STATUS_LABEL[quote.status],
    rfq: { id: quote.rfq.id, number: quote.rfq.number, subject: quote.rfq.subject, status: quote.rfq.status, owner: quote.rfq.owner.name },
    customer: { name: quote.rfq.customer.name, contactEmail: quote.rfq.customer.contactEmail },
    basisDate: dateStr(quote.basisDate),
    basisReason: quote.basisReason,
    requiresApproval: quote.requiresApproval,
    approval: body.approval as ApprovalResult,
    snapshot: quote.snapshots[0] ? { id: quote.snapshots[0].id, hash: quote.snapshots[0].hash, seq: quote.snapshots[0].seq, createdAt: isoStr(quote.snapshots[0].createdAt) } : null,
    submitted: quote.submittedAt ? { by: quote.submittedBy?.name ?? "", at: isoStr(quote.submittedAt) } : null,
    decided: quote.decidedAt ? { by: quote.decidedBy?.name ?? null, at: isoStr(quote.decidedAt), note: quote.decisionNote, onDate: toIstDate(quote.decidedAt) } : null,
    sent: quote.sentAt ? { by: quote.sentBy?.name ?? "", at: isoStr(quote.sentAt), to: quote.sentTo } : null,
    outbox: quote.outbox.map((m) => ({ ...m, createdAt: isoStr(m.createdAt) })),
    marginFloor: floor,
    parts,
    problems,
    document,
  };
}
export type QuotePage = Awaited<ReturnType<typeof getQuotePage>>;
