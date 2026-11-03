"use client";

import { FileSpreadsheet, FileText, Image as ImageIcon, Mail, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Section } from "@/components/ui/page";
import { htmlToText } from "@/domain/intake/email";
import { cn } from "@/lib/cn";
import { addTextSourceAction, createIntakeAction, startSampleAction } from "../actions";

const MAX = 4 * 1024 * 1024;
const ACCEPT = ".eml,.txt,.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg";

function iconFor(name: string) {
  if (/\.(eml|txt)$/i.test(name)) return Mail;
  if (/\.(xlsx|xls|csv)$/i.test(name)) return FileSpreadsheet;
  if (/\.(png|jpe?g)$/i.test(name)) return ImageIcon;
  return FileText;
}

/**
 * A whole drawing photo is cropped to its title block (bottom-right, ISO 7200) in the browser, so
 * only that region is sent for AI reading. A picture that is already a title-block strip is kept.
 */
async function cropTitleBlock(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const strip = bitmap.width / bitmap.height > 3;
  const sx = strip ? 0 : Math.floor(bitmap.width * 0.45);
  const sy = strip ? 0 : Math.floor(bitmap.height * 0.6);
  const w = bitmap.width - sx;
  const h = bitmap.height - sy;
  const scale = Math.min(1, 2000 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the image"))), "image/jpeg", 0.85));
  return new File([blob], `${file.name.replace(/\.\w+$/, "")} (title block).jpg`, { type: "image/jpeg" });
}

export function IntakeStart({ samples }: { samples: Array<{ id: string; title: string; blurb: string }> }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(list: FileList | File[]) {
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX) {
        setError(`${f.name} is larger than 4 MB.`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  }

  async function upload(sessionId: string, file: File, extract = true) {
    const form = new FormData();
    form.set("file", file);
    form.set("extract", String(extract));
    const res = await fetch(`/api/intake/${sessionId}/files`, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`${file.name}: ${body.error ?? `upload failed (${res.status})`}`);
    }
  }

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createIntakeAction({});
        if (!created.ok) throw new Error(created.error);
        const sessionId = created.data.sessionId;
        for (const file of files) {
          setStatus(`Uploading ${file.name}…`);
          if (/\.eml$/i.test(file.name)) {
            const PostalMime = (await import("postal-mime")).default;
            const mail = await PostalMime.parse(await file.arrayBuffer());
            const res = await addTextSourceAction({
              sessionId,
              label: `Email: ${mail.subject ?? file.name}`,
              text: mail.text ?? htmlToText(mail.html ?? ""),
              from: mail.from?.address ? `${mail.from.name ?? ""} <${mail.from.address}>` : null,
              subject: mail.subject ?? null,
              date: mail.date ?? null,
            });
            if (!res.ok) throw new Error(res.error);
            for (const a of mail.attachments) {
              const attached = new File([a.content as ArrayBuffer], a.filename ?? "attachment", { type: a.mimeType });
              if (attached.size > MAX) throw new Error(`${attached.name} (attached to the email) is larger than 4 MB.`);
              if (/^image\//.test(a.mimeType)) await upload(sessionId, await cropTitleBlock(attached));
              else await upload(sessionId, attached);
            }
          } else if (/\.(png|jpe?g)$/i.test(file.name)) {
            await upload(sessionId, await cropTitleBlock(file));
            await upload(sessionId, file, false);
          } else {
            await upload(sessionId, file);
          }
        }
        if (pasted.trim()) {
          const res = await addTextSourceAction({ sessionId, label: "Pasted email", text: pasted, from: null, subject: null, date: null });
          if (!res.ok) throw new Error(res.error);
        }
        router.push(`/intake/${sessionId}`);
      } catch (e) {
        setStatus(null);
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function sample(pack: string) {
    setError(null);
    startTransition(async () => {
      setStatus("Loading the sample…");
      const res = await startSampleAction({ pack });
      if (res.ok) router.push(`/intake/${res.data.sessionId}`);
      else {
        setStatus(null);
        setError(res.error);
      }
    });
  }

  const ready = files.length > 0 || pasted.trim().length > 20;

  return (
    <div className="flex flex-col gap-5">
      <Section title="RFQ documents">
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-subtle/60",
          )}
        >
          <Upload className="mb-2 size-5 text-ink-3" aria-hidden />
          <p className="text-sm font-medium">Drop the RFQ email, part list and drawings</p>
          <p className="mt-1 text-xs text-ink-3">.eml · .xlsx / .xls / .csv · .pdf · .png / .jpg — up to 4 MB each</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => e.target.files && add(e.target.files)} />
        </div>

        {files.length ? (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {files.map((f, i) => {
              const Icon = iconFor(f.name);
              return (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2 text-dense">
                  <Icon className="size-4 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-ink-3">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover" aria-label={`Remove ${f.name}`}>
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <Field label="Or paste the email text" htmlFor="pasted" className="mt-4">
          <Textarea id="pasted" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Dear Sir, please quote for …" />
        </Field>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-3" aria-live="polite">
            {error ? <span className="text-danger">{error}</span> : status}
          </p>
          <Button variant="primary" onClick={start} loading={pending} disabled={!ready}>
            Read documents
          </Button>
        </div>
      </Section>

      <Section title="Try a sample RFQ" description="Generated, fictional documents — the same files are in sample-data/rfq-packs.">
        <ul className="flex flex-col gap-3">
          {samples.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs text-ink-3">{s.blurb}</p>
              </div>
              <Button size="sm" onClick={() => sample(s.id)} disabled={pending}>
                Use this sample
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
