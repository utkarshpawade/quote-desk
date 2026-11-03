import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { UserError } from "@/server/errors";
import { jsonError, route } from "@/server/http";
import { analyzePastQuotes, importPastQuotes, MAX_IMPORT_BYTES, readSampleImport, SAMPLE_IMPORTS, type SampleImport } from "@/server/services/past-quote-import";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Past-quote import. `mode=analyze` is the dry run; `mode=import` re-reads the same file and
 * writes. The file is sent again rather than trusting the preview the browser holds.
 */
export const POST = route({ permission: "import.run" }, async (request, { user }) => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return jsonError(413, "Files must be 4 MB or smaller.");
  const form = await request.formData();
  const mode = form.get("mode");
  if (mode !== "analyze" && mode !== "import") throw new UserError("Unknown import mode.");

  const sample = form.get("sample");
  let file: { bytes: Uint8Array; filename: string };
  if (typeof sample === "string" && sample) {
    if (!(sample in SAMPLE_IMPORTS)) throw new UserError("Unknown sample file.");
    file = await readSampleImport(sample as SampleImport);
  } else {
    const upload = form.get("file");
    if (!(upload instanceof File)) throw new UserError("No file was attached.");
    if (upload.size > MAX_IMPORT_BYTES) return jsonError(413, "Files must be 4 MB or smaller.");
    if (!/\.(xlsx|xls|csv)$/i.test(upload.name)) throw new UserError("Upload the register as .xlsx, .xls or .csv.");
    file = { bytes: new Uint8Array(await upload.arrayBuffer()), filename: upload.name };
  }

  if (mode === "analyze") return NextResponse.json(await analyzePastQuotes(db, file));
  return NextResponse.json(await importPastQuotes(db, user, file));
});
