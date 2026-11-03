import { todayIst, toIstDate } from "@/domain/calendar";
import type { QuoteDocument } from "@/domain/quote-document";
import type { DbOrTx } from "@/server/db-client";
import { NotFoundError } from "@/server/errors";
import { renderQuotePdf } from "@/server/pdf/quote-pdf";
import { buildQuoteDocument } from "./quote-document";
import { assembleQuote, getSnapshotBody } from "./quote-lifecycle";

/**
 * The customer document for any quote: drafts are assembled live (watermarked), everything else
 * renders from its frozen snapshot so an issued quote can never change after the fact.
 */
export async function quoteDocumentFor(db: DbOrTx, quoteId: string): Promise<QuoteDocument> {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    select: { status: true, requiresApproval: true, decisionNote: true, decidedAt: true, decidedBy: { select: { name: true } } },
  });
  if (!quote) throw new NotFoundError("Quote");

  if (quote.status === "DRAFT") {
    const { body } = await assembleQuote(db, quoteId, todayIst());
    return buildQuoteDocument(body, { status: "DRAFT", shortHash: null, approvedBy: null, approvedOn: null, approvalNote: null });
  }

  const snapshot = await getSnapshotBody(db, quoteId);
  if (!snapshot) throw new NotFoundError("Quote snapshot");
  const approved = quote.status === "APPROVED" || quote.status === "SENT" || quote.status === "SUPERSEDED";
  const bySalesHead = approved && quote.requiresApproval === true;
  return buildQuoteDocument(snapshot.body, {
    status: quote.status,
    shortHash: snapshot.hash.slice(0, 8),
    approvedBy: bySalesHead ? (quote.decidedBy?.name ?? null) : null,
    approvedOn: approved && quote.decidedAt ? toIstDate(quote.decidedAt) : null,
    approvalNote: approved ? quote.decisionNote : null,
  });
}

export async function renderQuotePdfFor(db: DbOrTx, quoteId: string): Promise<Buffer> {
  return renderQuotePdf(await quoteDocumentFor(db, quoteId));
}
