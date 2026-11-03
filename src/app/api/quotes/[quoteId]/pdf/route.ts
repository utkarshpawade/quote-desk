import { headers } from "next/headers";
import { clientIp } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { contentDisposition } from "@/server/files/serve";
import { route } from "@/server/http";
import { renderQuotePdfFor } from "@/server/services/quote-pdf";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The quote PDF. Once sent, this returns the exact bytes that were sent (stored with the mock
 * email); before that it renders from the frozen snapshot, or live with a DRAFT watermark.
 */
export const GET = route<{ quoteId: string }>({ permission: "rfq.view" }, async (request, { user, params }) => {
  const quote = await db.quote.findUnique({
    where: { id: params.quoteId },
    select: { id: true, number: true, outbox: { orderBy: { createdAt: "desc" }, take: 1, select: { pdfFileId: true } } },
  });
  if (!quote) throw new NotFoundError("Quote");

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  let bytes: Uint8Array<ArrayBuffer>;
  const sentFileId = quote.outbox[0]?.pdfFileId;
  if (sentFileId) {
    const file = await db.storedFile.findUniqueOrThrow({ where: { id: sentFileId }, omit: { data: false } });
    bytes = new Uint8Array(file.data);
    await db.fileAccess.create({ data: { fileId: file.id, userId: user.id, action: inline ? "VIEW" : "DOWNLOAD", ip: clientIp(await headers()) } });
  } else {
    bytes = new Uint8Array(await renderQuotePdfFor(db, quote.id));
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(`${quote.number}.pdf`, inline),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
});
