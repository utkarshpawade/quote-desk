import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { isCronRequest, resetDemo } from "@/server/demo-reset";
import { UserError } from "@/server/errors";

export const runtime = "nodejs";
// The first reset also makes the first AI calls for the seeded intakes; later ones hit the cache.
export const maxDuration = 300;

/** Nightly demo reset (vercel.json: 21:30 UTC = 03:00 IST). Not behind the session proxy. */
export async function GET(request: Request) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await resetDemo(db);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[cron] demo reset failed", error);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}
