"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { db } from "@/server/db";
import { closeRfq, reviseRfq, submitQuote } from "@/server/services/quote-lifecycle";
import { previewReprice, repriceQuote, saveLine } from "@/server/services/quotes";
import { reassignRfq } from "@/server/services/rfqs";

const id = z.string().min(1).max(40);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

/** Autosave from the costing screen. No revalidation: the page must not re-render under the cursor. */
export const saveCostingAction = defineAction(
  { input: z.object({ lineId: id, lockVersion: z.number().int().min(0), draft: z.unknown() }), permission: "costing.edit" },
  (input, user) => saveLine(db, user, input),
);

export const submitQuoteAction = defineAction(
  { input: z.object({ quoteId: id, rfqId: id }), permission: "quote.submit" },
  async (input, user) => {
    const result = await submitQuote(db, user, input.quoteId);
    revalidatePath(`/rfqs/${input.rfqId}`, "layout");
    revalidatePath("/rfqs");
    return result;
  },
);

export const previewRepriceAction = defineAction(
  { input: z.object({ quoteId: id, basisDate: isoDate }), permission: "costing.edit" },
  (input) => previewReprice(db, input.quoteId, input.basisDate),
);

export const repriceAction = defineAction(
  { input: z.object({ quoteId: id, rfqId: id, basisDate: isoDate, reason: z.string().trim().max(300).nullable() }), permission: "costing.edit" },
  async (input) => {
    await repriceQuote(db, input);
    revalidatePath(`/rfqs/${input.rfqId}`, "layout");
    return null;
  },
);

export const closeRfqAction = defineAction(
  {
    input: z.object({
      rfqId: id,
      outcome: z.enum(["WON", "LOST", "REGRETTED"]),
      reason: z.enum(["PRICE", "LEAD_TIME", "TECHNICAL", "LATE_REPLY", "CUSTOMER_CANCELLED", "INCUMBENT_RETAINED", "CAPACITY", "OTHER"]).nullable(),
      note: z.string().trim().max(500).nullable(),
    }),
    permission: "rfq.close",
  },
  async (input, user) => {
    await closeRfq(db, user, input);
    revalidatePath(`/rfqs/${input.rfqId}`, "layout");
    revalidatePath("/rfqs");
    return null;
  },
);

export const reviseRfqAction = defineAction(
  { input: z.object({ rfqId: id }), permission: "costing.edit" },
  async (input, user) => {
    await reviseRfq(db, user, input.rfqId);
    revalidatePath(`/rfqs/${input.rfqId}`, "layout");
    revalidatePath("/rfqs");
    return null;
  },
);

export const reassignRfqAction = defineAction(
  { input: z.object({ rfqId: id, ownerId: id }), permission: "rfq.close" },
  async (input, user) => {
    await reassignRfq(db, user, input);
    revalidatePath(`/rfqs/${input.rfqId}`, "layout");
    revalidatePath("/rfqs");
    return null;
  },
);
