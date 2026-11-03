"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { db } from "@/server/db";
import { approveQuote, returnQuote, sendQuote } from "@/server/services/quote-lifecycle";
import { renderQuotePdfFor } from "@/server/services/quote-pdf";

const id = z.string().min(1).max(40);

function refresh(quoteId: string, rfqId: string) {
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath(`/rfqs/${rfqId}`, "layout");
  revalidatePath("/rfqs");
}

export const approveQuoteAction = defineAction(
  { input: z.object({ quoteId: id, rfqId: id, snapshotId: id, note: z.string().trim().max(500).nullable() }), permission: "quote.approve" },
  async (input, user) => {
    await approveQuote(db, user, input);
    refresh(input.quoteId, input.rfqId);
    return null;
  },
);

export const returnQuoteAction = defineAction(
  {
    input: z.object({ quoteId: id, rfqId: id, snapshotId: id, note: z.string().trim().max(1000), partIds: z.array(id).max(50) }),
    permission: "quote.approve",
  },
  async (input, user) => {
    await returnQuote(db, user, input);
    refresh(input.quoteId, input.rfqId);
    return null;
  },
);

export const sendQuoteAction = defineAction(
  {
    input: z.object({
      quoteId: id,
      rfqId: id,
      to: z.email("Enter the customer's email address").max(200),
      cc: z.union([z.email("Enter a valid email address").max(200), z.literal("")]).nullable(),
      subject: z.string().trim().min(3).max(200),
      message: z.string().trim().min(3).max(5000),
    }),
    permission: "quote.send",
  },
  async (input, user) => {
    await sendQuote(db, user, { ...input, cc: input.cc || null }, (quoteId) => renderQuotePdfFor(db, quoteId));
    refresh(input.quoteId, input.rfqId);
    return null;
  },
);
