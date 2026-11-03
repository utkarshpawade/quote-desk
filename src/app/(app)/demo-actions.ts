"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { db } from "@/server/db";
import { resetDemo } from "@/server/demo-reset";

export const resetDemoAction = defineAction({ input: z.object({}), permission: "demo.reset" }, async () => {
  const summary = await resetDemo(db);
  revalidatePath("/", "layout");
  return { rfqs: summary.rfqs, pastQuotes: summary.pastQuotes };
});
