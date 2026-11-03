import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/server/db-client";

/**
 * Append-only activity log (a DB trigger forbids UPDATE/DELETE). Always written in the same
 * transaction as the change it describes, so the timeline can never disagree with the data.
 */
export async function recordAudit(
  db: DbOrTx,
  event: {
    actorId: string | null;
    rfqId?: string | null;
    quoteId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    /** One readable sentence for the timeline: "Approved QT-2611-019-R0 (₹2.66 Cr)". */
    summary: string;
    data?: Prisma.InputJsonValue;
    /** Defaults to now; the seed passes historical times. */
    at?: Date;
  },
): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorId: event.actorId,
      rfqId: event.rfqId ?? null,
      quoteId: event.quoteId ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      summary: event.summary,
      data: event.data,
      ...(event.at ? { at: event.at } : {}),
    },
  });
}
