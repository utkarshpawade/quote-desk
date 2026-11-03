import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import PostalMime from "postal-mime";
import { addWorkingDays, todayIst } from "@/domain/calendar";
import type { DbOrTx } from "@/server/db-client";
import { UserError } from "@/server/errors";
import { addFileSource, addTextSource, createIntake } from "@/server/services/intake";

/**
 * Sample RFQ packs (sample-data/rfq-packs) loaded exactly as a dropped email would be: the body
 * becomes a text source and each attachment its own file source. Due dates in packs D and F are
 * moved relative to today so the demo never starts overdue; pack E keeps its deliberately
 * ambiguous date.
 */

export const SAMPLE_PACKS = [
  {
    id: "company-d-gear-blank",
    title: "Company D — gear blank",
    blurb: "Forwarded email, Excel part list and a drawing PDF. The source of RFQ-2611-023.",
  },
  {
    id: "company-e-brake-hub",
    title: "Company E — brake hub family",
    blurb: "Three parts: weights in grams, a monthly schedule, an ambiguous date, a material conflict and a drawing photo.",
  },
  {
    id: "company-f-yoke",
    title: "Company F — slip yoke",
    blurb: "A short email with an unknown grade and a prompt-injection line the AI must ignore.",
  },
] as const;

const PACK_DIR = path.join(process.cwd(), "sample-data", "rfq-packs");

function freshDate(workingDays: number): string {
  const [y, m, d] = addWorkingDays(todayIst(), workingDays).split("-");
  return `${d}/${m}/${y}`;
}

export async function startSampleIntake(db: DbOrTx, user: { id: string; name: string }, packId: string): Promise<string> {
  const pack = SAMPLE_PACKS.find((p) => p.id === packId);
  if (!pack) throw new UserError("Unknown sample.");
  const dir = path.join(PACK_DIR, pack.id);
  const files = await readdir(dir);
  const raw = await readFile(path.join(dir, "email.eml"), "utf8");
  const mail = await PostalMime.parse(raw);

  let body = mail.text ?? "";
  if (pack.id !== "company-e-brake-hub") body = body.replace(/\b\d{2}\/\d{2}\/2026\b/, freshDate(pack.id === "company-d-gear-blank" ? 9 : 12));

  const sessionId = await createIntake(db, user);
  await addTextSource(db, {
    sessionId,
    label: `Email: ${mail.subject ?? pack.title}`,
    text: body,
    from: mail.from?.address ? `${mail.from.name ?? ""} <${mail.from.address}>` : null,
    subject: mail.subject ?? null,
    date: new Date().toISOString(),
  });
  for (const attachment of mail.attachments) {
    const name = attachment.filename ?? "attachment";
    if (!files.includes(name)) continue;
    const bytes = new Uint8Array(attachment.content as ArrayBuffer);
    await addFileSource(db, user, { sessionId, filename: name, bytes, extract: true });
  }
  return sessionId;
}
