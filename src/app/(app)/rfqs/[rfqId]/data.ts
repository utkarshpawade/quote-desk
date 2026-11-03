import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getWorkspace } from "@/server/services/rfqs";

/** One workspace load per request, shared by the layout (header, tabs) and the tab pages. */
export const loadWorkspace = cache(async (rfqId: string) => {
  try {
    return await getWorkspace(db, rfqId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
