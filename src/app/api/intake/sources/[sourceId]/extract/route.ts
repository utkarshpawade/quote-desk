import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { extractSource } from "@/server/services/intake";

export const runtime = "nodejs";
/** One source per request keeps each call inside the function time limit (45 s AI budget). */
export const maxDuration = 60;

export const POST = route<{ sourceId: string }>({ permission: "intake.run" }, async (_request, { user, params }) => {
  const outcome = await extractSource(db, user, params.sourceId);
  return NextResponse.json(outcome);
});
