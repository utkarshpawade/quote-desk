import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { UserError } from "@/server/errors";
import { jsonError, route } from "@/server/http";
import { addFileSource, MAX_FILE_BYTES } from "@/server/services/intake";

export const runtime = "nodejs";

/** One file per request (Vercel caps request bodies at 4.5 MB); size is checked before reading. */
export const POST = route<{ sessionId: string }>({ permission: "intake.run" }, async (request, { user, params }) => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_FILE_BYTES + 64 * 1024) return jsonError(413, "Files must be 4 MB or smaller.");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new UserError("No file was attached.");
  if (file.size > MAX_FILE_BYTES) return jsonError(413, "Files must be 4 MB or smaller.");
  const sourceId = await addFileSource(db, user, {
    sessionId: params.sessionId,
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    extract: form.get("extract") !== "false",
  });
  return NextResponse.json({ sourceId });
});
