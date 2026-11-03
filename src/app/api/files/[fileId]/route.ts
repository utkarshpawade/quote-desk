import { headers } from "next/headers";
import { clientIp } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { fileHeaders } from "@/server/files/serve";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Drawings and RFQ documents for signed-in named users only; every access is logged (NDA). */
export const GET = route<{ fileId: string }>({ permission: "rfq.view" }, async (request, { user, params }) => {
  const file = await db.storedFile.findUnique({ where: { id: params.fileId }, omit: { data: false } });
  if (!file) throw new NotFoundError("File");
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  await db.fileAccess.create({
    data: { fileId: file.id, userId: user.id, action: inline ? "VIEW" : "DOWNLOAD", ip: clientIp(await headers()) },
  });
  return new Response(new Uint8Array(file.data), { headers: fileHeaders(file, inline) });
});
