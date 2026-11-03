"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { db } from "@/server/db";
import { addRateVersion, voidRateVersion } from "@/server/services/rate-admin";

export const addRateVersionAction = defineAction(
  {
    input: z.object({
      itemId: z.string().min(1).max(40),
      value: z
        .string()
        .trim()
        .regex(/^-?\d+(\.\d{1,4})?$/, "Up to 4 decimals"),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
      note: z.string().trim().max(300).nullable(),
      confirmLargeChange: z.boolean(),
    }),
    permission: "rates.manage",
  },
  async (input, user) => {
    const result = await addRateVersion(db, user, input);
    if (!result.largeChange) revalidatePath("/rates");
    return result;
  },
);

export const voidRateVersionAction = defineAction(
  { input: z.object({ versionId: z.string().min(1).max(40), reason: z.string().trim().max(300) }), permission: "rates.manage" },
  async (input, user) => {
    const result = await voidRateVersion(db, user, input);
    revalidatePath("/rates");
    return result;
  },
);
