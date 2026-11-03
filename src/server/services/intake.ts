import { createHash } from "node:crypto";
import PostalMime from "postal-mime";
import { todayIst, toIstDate, type IsoDate } from "@/domain/calendar";
import { emailAddress, htmlToText, numberLines, unwrapForwarded } from "@/domain/intake/email";
import { FIELD_BY_KEY } from "@/domain/intake/fields";
import { mergeCandidates, type Candidate } from "@/domain/intake/merge";
import { customerFromEmail, matchMaterial, parseAnnualVolume, parseDate, parseWeightKg, type MaterialOption } from "@/domain/intake/normalize";
import { toCandidate, type RawValue, type SourceInfo } from "@/domain/intake/read";
import { readByRules } from "@/domain/intake/rules";
import type { Prisma } from "@/generated/prisma/client";
import { AiUnavailableError, aiConfig } from "@/server/ai/groq";
import { extractWithAi, PROMPT_VERSION, transcribeImage } from "@/server/ai/extract";
import type { Db, DbOrTx } from "@/server/db-client";
import { isoStr } from "@/server/dto";
import { NotFoundError, UserError } from "@/server/errors";
import { SpreadsheetError } from "@/server/files/spreadsheet";
import { readDrawingPdf, readPartList } from "@/server/intake/parse";
import { recordAudit } from "./audit";
import { loadCatalog } from "./rates";
import { createRfq, type NewPart } from "./rfqs";

/**
 * RFQ intake: sources in, reviewed values out (DESIGN.md §5). The AI only reads; everything it
 * reads is grounded, scored and merged deterministically, and nothing reaches an RFQ until the
 * estimator has decided it.
 */

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const AI_CALLS_PER_USER_PER_HOUR = 40;
const UPLOAD_BYTES_PER_USER_PER_DAY = 60 * 1024 * 1024;

type User = { id: string; name: string };

const TYPES = {
  pdf: { mime: "application/pdf", kind: "DRAWING_PDF", file: "DRAWING" },
  png: { mime: "image/png", kind: "DRAWING_IMAGE", file: "DRAWING" },
  jpeg: { mime: "image/jpeg", kind: "DRAWING_IMAGE", file: "DRAWING" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "EXCEL", file: "PART_LIST" },
  xls: { mime: "application/vnd.ms-excel", kind: "EXCEL", file: "PART_LIST" },
  csv: { mime: "text/csv", kind: "EXCEL", file: "PART_LIST" },
  eml: { mime: "message/rfc822", kind: "EMAIL", file: "RFQ_EMAIL" },
  txt: { mime: "text/plain", kind: "PASTED_TEXT", file: "RFQ_EMAIL" },
} as const;

/** File type from its first bytes (never from the browser's claim), the extension only for text formats. */
export function sniffType(bytes: Uint8Array, filename: string): keyof typeof TYPES | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return /\.xlsx$/i.test(filename) ? "xlsx" : null;
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return /\.xls$/i.test(filename) ? "xls" : null;
  if (/\.csv$/i.test(filename)) return "csv";
  if (/\.eml$/i.test(filename)) return "eml";
  if (/\.txt$/i.test(filename)) return "txt";
  return null;
}

// ─── sessions and sources ──────────────────────────────────────────────────────

export async function createIntake(db: DbOrTx, user: User): Promise<string> {
  const session = await db.intakeSession.create({ data: { createdById: user.id } });
  return session.id;
}

async function assertOpen(db: DbOrTx, sessionId: string) {
  const session = await db.intakeSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!session) throw new NotFoundError("Intake");
  if (session.status === "COMPLETED" || session.status === "DISCARDED") throw new UserError("This intake is closed.");
}

export async function addTextSource(
  db: DbOrTx,
  args: { sessionId: string; label: string; text: string; from?: string | null; subject?: string | null; date?: string | null },
): Promise<string> {
  await assertOpen(db, args.sessionId);
  const text = args.text.slice(0, 100_000);
  if (!text.trim()) throw new UserError("The email text is empty.");
  const forwarded = unwrapForwarded(text);
  const source = await db.intakeSource.create({
    data: {
      sessionId: args.sessionId,
      kind: args.from || forwarded ? "EMAIL" : "PASTED_TEXT",
      label: args.label.slice(0, 200),
      text: numberLines(forwarded ? forwarded.body : text),
      meta: {
        from: forwarded?.from ?? args.from ?? null,
        subject: forwarded?.subject ?? args.subject ?? null,
        date: forwarded?.date ?? args.date ?? null,
        forwardedBy: forwarded ? (args.from ?? null) : null,
      },
    },
  });
  return source.id;
}

export async function addFileSource(
  db: DbOrTx,
  user: User,
  args: { sessionId: string; filename: string; bytes: Uint8Array; extract: boolean },
): Promise<string> {
  await assertOpen(db, args.sessionId);
  if (args.bytes.byteLength > MAX_FILE_BYTES) throw new UserError("Files must be 4 MB or smaller.");
  const type = sniffType(args.bytes, args.filename);
  if (!type) throw new UserError("Upload an email (.eml or .txt), a part list (.xlsx, .xls, .csv) or a drawing (.pdf, .png, .jpg).");

  const since = new Date(Date.now() - 86_400_000);
  const used = await db.storedFile.aggregate({ where: { uploadedById: user.id, createdAt: { gte: since } }, _sum: { sizeBytes: true } });
  if ((used._sum.sizeBytes ?? 0) + args.bytes.byteLength > UPLOAD_BYTES_PER_USER_PER_DAY) {
    throw new UserError("You have reached today's upload limit for the demo (60 MB).");
  }

  // Emails become text sources; their attachments arrive as separate uploads from the browser.
  if (type === "eml" || type === "txt") {
    const raw = new TextDecoder().decode(args.bytes);
    if (type === "txt") return addTextSource(db, { sessionId: args.sessionId, label: args.filename, text: raw });
    const mail = await PostalMime.parse(raw);
    return addTextSource(db, {
      sessionId: args.sessionId,
      label: mail.subject ? `Email: ${mail.subject}` : args.filename,
      text: mail.text ?? htmlToText(mail.html ?? ""),
      from: mail.from?.address ? `${mail.from.name ?? ""} <${mail.from.address}>`.trim() : null,
      subject: mail.subject ?? null,
      date: mail.date ?? null,
    });
  }

  const t = TYPES[type];
  const file = await db.storedFile.create({
    data: {
      kind: t.file,
      filename: args.filename.slice(0, 200),
      mimeType: t.mime,
      sizeBytes: args.bytes.byteLength,
      sha256: createHash("sha256").update(args.bytes).digest("hex"),
      data: new Uint8Array(args.bytes),
      uploadedById: user.id,
    },
    select: { id: true },
  });
  const source = await db.intakeSource.create({
    data: {
      sessionId: args.sessionId,
      kind: t.kind,
      label: args.filename.slice(0, 200),
      fileId: file.id,
      ...(args.extract ? {} : { status: "DONE", meta: { storedOnly: true } }),
    },
  });
  return source.id;
}

// ─── extraction ────────────────────────────────────────────────────────────────

async function materialsList(db: DbOrTx): Promise<MaterialOption[]> {
  const items = await loadCatalog(db, { categories: ["MATERIAL"] });
  return items.map((i) => ({ id: i.id, grade: String(i.attributes.grade ?? i.code), aliases: Array.isArray(i.attributes.aliases) ? (i.attributes.aliases as string[]) : [] }));
}

/** The customer the session's email came from, if recognised — it decides whether AI may be used. */
async function sessionCustomer(db: DbOrTx, sessionId: string) {
  const sources = await db.intakeSource.findMany({ where: { sessionId, kind: { in: ["EMAIL", "PASTED_TEXT"] } }, select: { meta: true } });
  const customers = await db.customer.findMany({ select: { id: true, name: true, emailDomain: true, aiAllowed: true } });
  for (const s of sources) {
    const from = (s.meta as { from?: string } | null)?.from;
    const address = from ? emailAddress(from) : null;
    const customer = address ? customerFromEmail(address, customers) : null;
    if (customer) return customer;
  }
  return null;
}

async function aiBudgetLeft(db: DbOrTx, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000);
  const calls = await db.intakeSource.count({ where: { mode: "AI", cachedAt: null, startedAt: { gte: since }, session: { createdById: userId } } });
  return calls < AI_CALLS_PER_USER_PER_HOUR;
}

/** AI extraction with a cache keyed on prompt version, model and exactly what is sent. */
async function cachedExtraction(db: DbOrTx, label: string, text: string) {
  const { textModel } = aiConfig();
  const key = createHash("sha256").update(`${PROMPT_VERSION}\n${textModel}\n${text}`).digest("hex");
  const hit = await db.aiExtractionCache.findUnique({ where: { key } });
  if (hit) return { values: hit.result as unknown as RawValue[], model: hit.model, cached: true };
  const result = await extractWithAi({ label, text });
  await db.aiExtractionCache.upsert({
    where: { key },
    create: { key, model: result.model, promptVersion: PROMPT_VERSION, result: result.values as unknown as Prisma.InputJsonValue },
    update: {},
  });
  return { values: result.values, model: result.model, cached: false };
}

export interface ExtractOutcome {
  status: "DONE" | "NO_TEXT" | "FAILED";
  mode: "AI" | "RULES" | "PARSER" | null;
  message: string | null;
}

export async function extractSource(db: Db, user: User, sourceId: string): Promise<ExtractOutcome> {
  const source = await db.intakeSource.findUnique({ where: { id: sourceId }, include: { file: { omit: { data: false } }, session: { select: { id: true, createdAt: true } } } });
  if (!source) throw new NotFoundError("Source");
  await assertOpen(db, source.sessionId);
  const claimed = await db.intakeSource.updateMany({ where: { id: sourceId, status: { not: "PROCESSING" } }, data: { status: "PROCESSING", startedAt: new Date(), error: null } });
  if (claimed.count !== 1) throw new UserError("This source is already being read.");

  const meta = (source.meta ?? {}) as Record<string, unknown>;
  const materials = await materialsList(db);
  const customer = await sessionCustomer(db, source.sessionId);
  const aiAllowed = Boolean(aiConfig().apiKey) && customer?.aiAllowed !== false && (await aiBudgetLeft(db, user.id));
  const noAiReason = !aiConfig().apiKey ? "no AI key configured" : customer?.aiAllowed === false ? `AI disabled under ${customer.name}'s NDA` : "hourly AI limit reached";
  const receivedDate = typeof meta.date === "string" && !Number.isNaN(Date.parse(meta.date)) ? toIstDate(new Date(meta.date)) : toIstDate(source.session.createdAt);
  const ctx = { materials, receivedDate };

  let raw: RawValue[] = [];
  let text = "";
  // Set inside readText; kept on an object so the type is not narrowed away by control flow.
  const run: { mode: ExtractOutcome["mode"]; fallback: string | null } = { mode: null, fallback: null };
  const update: Prisma.IntakeSourceUpdateInput = {};

  const readText = async (label: string, body: string, kind: "EMAIL" | "TITLE_BLOCK") => {
    if (aiAllowed) {
      try {
        const res = await cachedExtraction(db, label, body);
        update.model = res.model;
        update.sentChars = body.length;
        update.sentSha256 = createHash("sha256").update(body).digest("hex");
        if (res.cached) update.cachedAt = new Date();
        run.mode = "AI";
        return res.values;
      } catch (error) {
        if (!(error instanceof AiUnavailableError)) throw error;
        run.fallback = `${error.message} Rule-based reading used instead.`;
      }
    } else {
      run.fallback = `Rule-based reading (${noAiReason}).`;
    }
    run.mode = "RULES";
    return readByRules(body, kind);
  };

  try {
    if (source.kind === "EMAIL" || source.kind === "PASTED_TEXT") {
      text = source.text ?? "";
      raw = await readText(source.label, text, "EMAIL");
      // Headers are facts, not readings: the sender identifies the customer (A-22).
      const from = typeof meta.from === "string" ? meta.from : null;
      const address = from ? emailAddress(from) : null;
      if (address) {
        const headerSource: SourceInfo = { id: `${source.id}:headers`, kind: source.kind, label: "Email headers", text: "", mode: "PARSER" };
        const known = customer ? [{ fieldKey: "customerName", raw: customer.name, evidence: from, locator: "From" }] : [];
        const headerValues: RawValue[] = [
          ...known,
          { fieldKey: "contactEmail", raw: address, evidence: from, locator: "From" },
          ...(typeof meta.subject === "string" ? [{ fieldKey: "subject", raw: meta.subject, evidence: meta.subject, locator: "Subject" }] : []),
        ];
        const headerCandidates = headerValues.map((v) => toCandidate(v, headerSource, ctx)).filter((c): c is Candidate => c !== null);
        update.meta = { ...meta, headerCandidates } as unknown as Prisma.InputJsonValue;
      }
    } else if (source.kind === "EXCEL") {
      const reading = readPartList(new Uint8Array(source.file!.data), source.label);
      raw = reading.values;
      run.mode = "PARSER";
      update.meta = { ...meta, excel: reading.meta } as unknown as Prisma.InputJsonValue;
    } else if (source.kind === "DRAWING_PDF") {
      const drawing = await readDrawingPdf(new Uint8Array(source.file!.data));
      if (!drawing.hasText) {
        await db.intakeSource.update({ where: { id: sourceId }, data: { status: "NO_TEXT", mode: null, finishedAt: new Date(), error: "No readable text — a scanned drawing. Upload a photo of the title block, or type the values." } });
        await settleSession(db, source.sessionId);
        return { status: "NO_TEXT", mode: null, message: "No readable text in this PDF." };
      }
      text = drawing.titleBlockText;
      raw = (await readText(source.label, text, "TITLE_BLOCK")).map((v) => ({ ...v, locator: v.locator?.startsWith("line") ? "title block" : v.locator, part: v.part ?? {} }));
      update.text = text;
      update.meta = { ...meta, hints: drawing.hints, usedRegion: drawing.usedRegion } as unknown as Prisma.InputJsonValue;
      if (run.mode === "AI") await db.fileAccess.create({ data: { fileId: source.fileId!, userId: user.id, action: "AI_EXTRACT", detail: `${drawing.usedRegion === "title-block" ? "Title block" : "Full page"} text, ${text.length} chars` } });
    } else if (source.kind === "DRAWING_IMAGE") {
      if (!aiAllowed) throw new AiUnavailableError("NO_KEY", `Drawing images can only be read by the AI (${noAiReason}). Type the values instead.`);
      const transcription = await transcribeImage(Buffer.from(source.file!.data).toString("base64"));
      text = transcription.text;
      raw = (await readText(`${source.label} (transcribed)`, text, "TITLE_BLOCK")).map((v) => ({ ...v, locator: "title block (image)", part: v.part ?? {} }));
      update.text = text;
      await db.fileAccess.create({ data: { fileId: source.fileId!, userId: user.id, action: "AI_EXTRACT", detail: `Image sent to ${transcription.model} for transcription` } });
    }

    const info: SourceInfo = { id: source.id, kind: source.kind, label: source.label, text, mode: run.mode ?? "PARSER" };
    const candidates = raw.map((v) => toCandidate(v, info, ctx)).filter((c): c is Candidate => c !== null);
    const nextMeta = { ...(((update.meta as object | undefined) ?? meta) as Record<string, unknown>), candidates };
    await db.intakeSource.update({
      where: { id: sourceId },
      data: { ...update, meta: nextMeta as unknown as Prisma.InputJsonValue, status: "DONE", mode: run.mode, finishedAt: new Date(), error: run.fallback },
    });
    if (run.fallback) await db.intakeSession.update({ where: { id: source.sessionId }, data: { fallbackReason: run.fallback } });
    if (run.mode === "AI") await db.intakeSession.update({ where: { id: source.sessionId }, data: { aiModel: aiConfig().textModel } });
    await recomputeFields(db, source.sessionId);
    await settleSession(db, source.sessionId);
    return { status: "DONE", mode: run.mode, message: run.fallback };
  } catch (error) {
    // Only messages written for people are shown; anything else is logged and replaced.
    const userFacing = error instanceof AiUnavailableError || error instanceof UserError || error instanceof SpreadsheetError;
    const message = userFacing ? (error as Error).message : "This file could not be read. Try again, or type the values.";
    if (!userFacing) console.error("[intake] extraction failed", sourceId, error);
    await db.intakeSource.update({ where: { id: sourceId }, data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 500) } });
    await settleSession(db, source.sessionId);
    return { status: "FAILED", mode: run.mode, message };
  }
}

/** Intakes read and waiting for an estimator's decisions (shown on the register). */
export async function listPendingIntakes(db: DbOrTx) {
  const sessions = await db.intakeSession.findMany({
    where: { status: "REVIEW" },
    orderBy: { createdAt: "asc" },
    take: 5,
    include: {
      createdBy: { select: { name: true } },
      sources: { select: { label: true }, orderBy: { createdAt: "asc" }, take: 1 },
      _count: { select: { fields: { where: { status: "PENDING" } } } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    label: (s.sources[0]?.label ?? "Untitled intake").replace(/^Email: /, ""),
    createdBy: s.createdBy.name,
    createdAt: isoStr(s.createdAt),
    pending: s._count.fields,
  }));
}

/** The session is ready for review once no source is still being read. */
async function settleSession(db: DbOrTx, sessionId: string) {
  const busy = await db.intakeSource.count({ where: { sessionId, status: { in: ["PENDING", "PROCESSING"] } } });
  if (busy === 0) await db.intakeSession.updateMany({ where: { id: sessionId, status: "EXTRACTING" }, data: { status: "REVIEW", reviewStartedAt: new Date() } });
}

/**
 * Re-merges every source's candidates; decisions already made are kept. Sources finish in
 * parallel, so the merge is serialized per session with a transaction-scoped advisory lock.
 */
export async function recomputeFields(db: Db, sessionId: string) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
    await mergeInto(tx, sessionId);
  });
}

async function mergeInto(db: DbOrTx, sessionId: string) {
  const sources = await db.intakeSource.findMany({ where: { sessionId, status: "DONE" }, select: { meta: true } });
  const candidates = sources.flatMap((s) => {
    const m = (s.meta ?? {}) as { candidates?: Candidate[]; headerCandidates?: Candidate[] };
    return [...(m.headerCandidates ?? []), ...(m.candidates ?? [])];
  });
  const proposals = mergeCandidates(candidates);
  const existing = await db.extractedField.findMany({ where: { sessionId } });
  const key = (partKey: string, fieldKey: string) => `${partKey}::${fieldKey}`;
  const byKey = new Map(existing.map((f) => [key(f.partKey, f.fieldKey), f]));
  const seen = new Set<string>();

  for (const p of proposals) {
    const k = key(p.partKey, p.fieldKey);
    seen.add(k);
    const data = {
      partLabel: p.partLabel,
      candidates: p.candidates as unknown as Prisma.InputJsonValue,
      confidence: p.confidence,
      reason: `${p.reason}${p.agreed ? " · agreed" : ""}`,
      conflict: p.conflict,
      sortOrder: p.sortOrder,
    };
    const row = byKey.get(k);
    if (!row) await db.extractedField.create({ data: { sessionId, partKey: p.partKey, fieldKey: p.fieldKey, proposedValue: p.proposedValue, ...data } });
    else await db.extractedField.update({ where: { id: row.id }, data: row.status === "PENDING" ? { ...data, proposedValue: p.proposedValue } : data });
  }
  const stale = existing.filter((f) => f.status === "PENDING" && !seen.has(key(f.partKey, f.fieldKey))).map((f) => f.id);
  if (stale.length) await db.extractedField.deleteMany({ where: { id: { in: stale } } });
}

// ─── review ────────────────────────────────────────────────────────────────────

export async function getIntakeReview(db: DbOrTx, sessionId: string) {
  const session = await db.intakeSession.findUnique({
    where: { id: sessionId },
    include: {
      createdBy: { select: { name: true } },
      rfq: { select: { id: true, number: true } },
      sources: { orderBy: { createdAt: "asc" }, include: { file: { select: { id: true, mimeType: true, sizeBytes: true } } } },
      fields: { orderBy: [{ partKey: "asc" }, { sortOrder: "asc" }], include: { decidedBy: { select: { name: true } } } },
    },
  });
  if (!session) throw new NotFoundError("Intake");
  const [customers, estimators, customer] = await Promise.all([
    db.customer.findMany({ select: { id: true, name: true, aiAllowed: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { role: "ESTIMATOR", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    sessionCustomer(db, sessionId),
  ]);
  return {
    id: session.id,
    status: session.status,
    createdBy: session.createdBy.name,
    createdAt: isoStr(session.createdAt),
    aiModel: session.aiModel,
    fallbackReason: session.fallbackReason,
    rfq: session.rfq,
    aiConfigured: Boolean(aiConfig().apiKey),
    customer,
    customers,
    estimators,
    sources: session.sources.map((s) => {
      const meta = (s.meta ?? {}) as { excel?: unknown; hints?: string[]; usedRegion?: string; storedOnly?: boolean; from?: string | null; subject?: string | null };
      return {
        id: s.id,
        kind: s.kind,
        label: s.label,
        status: s.status,
        mode: s.mode,
        model: s.model,
        error: s.error,
        text: s.text,
        fileId: s.file?.id ?? null,
        mimeType: s.file?.mimeType ?? null,
        sentChars: s.sentChars,
        cachedAt: isoStr(s.cachedAt),
        startedAt: isoStr(s.startedAt),
        storedOnly: Boolean(meta.storedOnly),
        excel: (meta.excel ?? null) as { sheet: string; headerRow: number; mapped: Array<{ field: string; header: string; letter: string }>; unmapped: string[]; rows: number } | null,
        hints: meta.hints ?? [],
        usedRegion: meta.usedRegion ?? null,
        from: meta.from ?? null,
      };
    }),
    fields: session.fields.map((f) => ({
      id: f.id,
      partKey: f.partKey,
      partLabel: f.partLabel,
      fieldKey: f.fieldKey,
      label: FIELD_BY_KEY.get(f.fieldKey)?.label ?? f.fieldKey,
      type: FIELD_BY_KEY.get(f.fieldKey)?.type ?? "text",
      required: Boolean(FIELD_BY_KEY.get(f.fieldKey)?.required),
      proposedValue: f.proposedValue,
      candidates: f.candidates as unknown as Candidate[],
      confidence: f.confidence,
      reason: f.reason,
      conflict: f.conflict,
      agreed: (f.reason ?? "").endsWith("· agreed"),
      status: f.status,
      finalValue: f.finalValue,
      decidedVia: f.decidedVia,
      decidedBy: f.decidedBy?.name ?? null,
    })),
  };
}
export type IntakeReview = Awaited<ReturnType<typeof getIntakeReview>>;

/** Validates and normalizes a value the estimator typed, by field type. */
function normalizeTyped(fieldKey: string, value: string, materials: MaterialOption[]): string {
  const type = FIELD_BY_KEY.get(fieldKey)?.type ?? "text";
  const v = value.trim();
  if (!v) throw new UserError("Enter a value, or reject the field.");
  if (type === "weightKg") {
    const p = parseWeightKg(/[a-z]/i.test(v) ? v : `${v} kg`);
    if (!p || Number(p.value) <= 0) throw new UserError("Enter a weight such as 0.61 or 610 g.");
    return p.value;
  }
  if (type === "volume") {
    const p = parseAnnualVolume(v);
    if (!p || p.value <= 0) throw new UserError("Enter a yearly quantity such as 1,80,000 or 1.8 lakh.");
    return String(p.value);
  }
  if (type === "date") {
    const p = parseDate(v);
    if (!p) throw new UserError("Enter a date such as 12/11/2026.");
    return p.value;
  }
  if (type === "material") return matchMaterial(v, materials)?.grade ?? v;
  return v.slice(0, 200);
}

export async function decideField(
  db: DbOrTx,
  user: User,
  args: { fieldId: string; action: "ACCEPT" | "EDIT" | "REJECT" | "UNDO"; value?: string | null },
) {
  const field = await db.extractedField.findUnique({ where: { id: args.fieldId }, include: { session: { select: { status: true } } } });
  if (!field) throw new NotFoundError("Field");
  if (field.session.status === "COMPLETED" && field.status !== "PENDING") throw new UserError("This value has already been used on the RFQ.");
  const now = new Date();
  if (args.action === "UNDO") {
    await db.extractedField.update({ where: { id: field.id }, data: { status: "PENDING", finalValue: null, decidedVia: null, decidedById: null, decidedAt: null } });
    return;
  }
  if (args.action === "REJECT") {
    await db.extractedField.update({ where: { id: field.id }, data: { status: "REJECTED", finalValue: null, decidedVia: "SINGLE", decidedById: user.id, decidedAt: now } });
    return;
  }
  const materials = await materialsList(db);
  if (args.action === "ACCEPT") {
    const value = args.value ?? field.proposedValue;
    if (!value) throw new UserError("Nothing to accept — choose a value or type one.");
    const candidates = (field.candidates ?? []) as unknown as Candidate[];
    if (!candidates.some((c) => c.value === value)) throw new UserError("That value is not one the sources gave; edit it instead.");
    await db.extractedField.update({ where: { id: field.id }, data: { status: "ACCEPTED", finalValue: value, decidedVia: "SINGLE", decidedById: user.id, decidedAt: now } });
    return;
  }
  const value = normalizeTyped(field.fieldKey, args.value ?? "", materials);
  await db.extractedField.update({ where: { id: field.id }, data: { status: "EDITED", finalValue: value, decidedVia: "EDITED", decidedById: user.id, decidedAt: now } });
}

/** Adds a field the sources did not give (typed by the estimator), e.g. a missing due date. */
export async function addTypedField(db: DbOrTx, user: User, args: { sessionId: string; partKey: string; fieldKey: string; value: string }) {
  if (!FIELD_BY_KEY.has(args.fieldKey)) throw new UserError("Unknown field.");
  const value = normalizeTyped(args.fieldKey, args.value, await materialsList(db));
  await db.extractedField.upsert({
    where: { sessionId_partKey_fieldKey: { sessionId: args.sessionId, partKey: args.partKey, fieldKey: args.fieldKey } },
    create: { sessionId: args.sessionId, partKey: args.partKey, fieldKey: args.fieldKey, candidates: [], confidence: "HIGH", reason: "typed by the estimator", status: "EDITED", finalValue: value, decidedVia: "EDITED", decidedById: user.id, decidedAt: new Date() },
    update: { status: "EDITED", finalValue: value, decidedVia: "EDITED", decidedById: user.id, decidedAt: new Date() },
  });
}

/** Confirms one Excel column at once: every undecided value read from it (A deliberate, logged action). */
export async function acceptColumn(db: DbOrTx, user: User, args: { sessionId: string; sourceId: string; letter: string }) {
  const fields = await db.extractedField.findMany({ where: { sessionId: args.sessionId, status: "PENDING", conflict: false, proposedValue: { not: null } } });
  const ids = fields
    .filter((f) => ((f.candidates ?? []) as unknown as Candidate[]).some((c) => c.sourceId === args.sourceId && c.column?.letter === args.letter && c.value === f.proposedValue))
    .map((f) => f.id);
  if (ids.length === 0) return 0;
  const updated = await db.extractedField.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "ACCEPTED", decidedVia: "COLUMN", decidedById: user.id, decidedAt: new Date() },
  });
  await db.$executeRaw`UPDATE "ExtractedField" SET "finalValue" = "proposedValue" WHERE id = ANY(${ids}) AND "decidedVia" = 'COLUMN'`;
  return updated.count;
}

/** Per part: accepts the values where two or more sources agree and all were found in their source. */
export async function acceptAgreed(db: DbOrTx, user: User, args: { sessionId: string; partKey: string }) {
  const fields = await db.extractedField.findMany({ where: { sessionId: args.sessionId, partKey: args.partKey, status: "PENDING", conflict: false, proposedValue: { not: null }, reason: { endsWith: "· agreed" } } });
  for (const f of fields) {
    await db.extractedField.update({ where: { id: f.id }, data: { status: "ACCEPTED", finalValue: f.proposedValue, decidedVia: "AGREED", decidedById: user.id, decidedAt: new Date() } });
  }
  return fields.length;
}

// ─── creating the RFQ ──────────────────────────────────────────────────────────

export async function createRfqFromIntake(db: Db, user: User, args: { sessionId: string; customerId: string; ownerId: string }) {
  const review = await getIntakeReview(db, args.sessionId);
  if (review.status === "COMPLETED") throw new UserError("This intake already created an RFQ.");
  const decided = (f: (typeof review.fields)[number]) => f.status === "ACCEPTED" || f.status === "EDITED";
  const value = (partKey: string, fieldKey: string) => {
    const f = review.fields.find((x) => x.partKey === partKey && x.fieldKey === fieldKey && decided(x));
    return f?.finalValue ?? null;
  };

  const dueDate = value("", "dueDate");
  if (!dueDate) throw new UserError("Decide the quote due date first (accept it, or type it).");
  const materials = await materialsList(db);
  const partKeys = [...new Set(review.fields.filter((f) => f.partKey).map((f) => f.partKey))];
  const parts: Array<NewPart & { partKey: string }> = [];
  const missing: string[] = [];
  for (const partKey of partKeys) {
    const all = review.fields.filter((f) => f.partKey === partKey);
    if (all.every((f) => f.status === "REJECTED")) continue; // the estimator dropped this part
    const description = value(partKey, "description");
    const annualVolume = value(partKey, "annualVolume");
    if (!description || !annualVolume) {
      missing.push(all[0]?.partLabel ?? partKey);
      continue;
    }
    const material = value(partKey, "material");
    parts.push({
      partKey,
      partNo: value(partKey, "partNo") ?? partKey,
      description,
      drawingNo: value(partKey, "drawingNo"),
      drawingRev: value(partKey, "drawingRev"),
      materialText: material,
      materialItemId: material ? (matchMaterial(material, materials)?.id ?? null) : null,
      grossWeightKg: value(partKey, "grossWeightKg"),
      netWeightKg: value(partKey, "netWeightKg"),
      annualVolume: Number(annualVolume),
      heatTreatment: value(partKey, "heatTreatment"),
      surfaceTreatment: value(partKey, "surfaceTreatment"),
      processHints: [...new Set(review.sources.flatMap((s) => s.hints))],
    });
  }
  if (missing.length) throw new UserError(`Decide the description and annual volume for: ${missing.join(", ")} — or reject that part's values to leave it out.`);
  if (parts.length === 0) throw new UserError("Add at least one part with a description and an annual volume.");

  const receivedDate = value("", "receivedDate") as IsoDate | null;
  const receivedAt = receivedDate && receivedDate <= todayIst() ? new Date(`${receivedDate}T10:00:00+05:30`) : new Date(review.createdAt);
  const customer = review.customers.find((c) => c.id === args.customerId);
  if (!customer) throw new UserError("Choose the customer.");

  return db.$transaction(
    async (tx) => {
      const rfq = await createRfq(tx, user, {
        customerId: args.customerId,
        customerRef: value("", "customerRef"),
        subject: value("", "subject") ?? `${parts[0]!.description}${parts.length > 1 ? ` and ${parts.length - 1} more` : ""}`,
        receivedAt,
        dueDate,
        ownerId: args.ownerId,
        parts,
      });
      const partIdByKey = new Map(parts.map((p, i) => [p.partKey, rfq.partIds[i]!]));
      const via: Record<string, number> = {};
      for (const f of review.fields) {
        const partId = f.partKey ? partIdByKey.get(f.partKey) : null;
        if (f.partKey && !partId) continue;
        if (decided(f) && f.finalValue) {
          via[f.decidedVia ?? "SINGLE"] = (via[f.decidedVia ?? "SINGLE"] ?? 0) + 1;
          const best = f.candidates.find((c) => c.value === f.finalValue) ?? f.candidates[0];
          await tx.fieldProvenance.create({
            data: {
              rfqId: rfq.id,
              rfqPartId: partId ?? null,
              fieldKey: f.fieldKey,
              value: f.finalValue,
              sourceKind: best?.sourceKind ?? "PASTED_TEXT",
              sourceLabel: best?.sourceLabel ?? "Typed by the estimator",
              locator: best?.locator ?? null,
              evidence: best?.evidence ?? null,
              confidence: f.confidence,
              decidedVia: f.decidedVia ?? "SINGLE",
              proposedValue: f.status === "EDITED" ? f.proposedValue : null,
              extractedFieldId: f.id,
              acceptedById: user.id,
            },
          });
        } else if (f.status === "PENDING" && partId) {
          // Undecided values follow the part and block its submission until decided.
          await tx.extractedField.update({ where: { id: f.id }, data: { rfqPartId: partId } });
        }
      }
      await tx.storedFile.updateMany({ where: { intakeSources: { some: { sessionId: args.sessionId } } }, data: { rfqId: rfq.id } });
      await tx.intakeSession.update({ where: { id: args.sessionId }, data: { status: "COMPLETED", rfqId: rfq.id, reviewCompletedAt: new Date() } });
      const decidedCount = Object.values(via).reduce((a, b) => a + b, 0);
      const pending = review.fields.filter((f) => f.status === "PENDING" && (!f.partKey || partIdByKey.has(f.partKey))).length;
      await recordAudit(tx, {
        actorId: user.id,
        rfqId: rfq.id,
        entityType: "IntakeSession",
        entityId: args.sessionId,
        action: "intake.completed",
        summary: `${decidedCount} values from the RFQ documents accepted by ${user.name} (${Object.entries(via).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")})${pending ? `; ${pending} left to review on the parts` : ""}${review.aiModel ? ` · read by ${review.aiModel}` : " · rule-based reading"}`,
      });
      return rfq;
    },
    { timeout: 60_000 },
  );
}

export async function discardIntake(db: DbOrTx, user: User, sessionId: string) {
  await db.intakeSession.updateMany({ where: { id: sessionId, createdById: user.id, status: { in: ["EXTRACTING", "REVIEW", "FAILED"] } }, data: { status: "DISCARDED" } });
}

