"use client";

import { Check, FileSpreadsheet, FileText, Image as ImageIcon, Mail, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Notice } from "@/components/ui/states";
import { FIELDS } from "@/domain/intake/fields";
import type { Candidate } from "@/domain/intake/merge";
import { cn } from "@/lib/cn";
import { formatDate, formatInteger } from "@/lib/format";
import type { IntakeReview } from "@/server/services/intake";
import { acceptAgreedAction, acceptColumnAction, addTypedFieldAction, createRfqFromIntakeAction, decideFieldAction, discardIntakeAction } from "../actions";

type Field = IntakeReview["fields"][number];
type Source = IntakeReview["sources"][number];

const KIND_ICON = { EMAIL: Mail, PASTED_TEXT: Mail, EXCEL: FileSpreadsheet, DRAWING_PDF: FileText, DRAWING_IMAGE: ImageIcon } as const;

function show(type: string, value: string | null): string {
  if (value === null) return "—";
  if (type === "weightKg") return `${Number(value)} kg`;
  if (type === "volume") return `${formatInteger(value)} / yr`;
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  return value;
}

const CONFIDENCE_TONE = { HIGH: "text-ink-3", MEDIUM: "text-warn", LOW: "text-danger" } as const;

/** Runs extraction for every unread source (two at a time), then reloads the review. */
function useExtraction(sources: Source[]) {
  const router = useRouter();
  const [state, setState] = useState<Partial<Record<string, "running" | "done" | "failed">>>({});
  const started = useRef(false);
  const pending = sources.filter((s) => s.status === "PENDING");

  useEffect(() => {
    if (started.current || pending.length === 0) return;
    started.current = true;
    const queue = [...pending];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift()!;
        setState((x) => ({ ...x, [s.id]: "running" }));
        const res = await fetch(`/api/intake/sources/${s.id}/extract`, { method: "POST" }).catch(() => null);
        setState((x) => ({ ...x, [s.id]: res?.ok ? "done" : "failed" }));
      }
    };
    void Promise.all([worker(), worker()]).then(() => router.refresh());
  }, [pending, router]);

  return { running: pending.length > 0, state };
}

export function IntakeReviewView({ review, currentUser }: { review: IntakeReview; currentUser: { id: string; role: string } }) {
  const router = useRouter();
  const { running, state } = useExtraction(review.sources);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<{ sourceId: string; locator: string | null } | null>(null);
  const [customerId, setCustomerId] = useState(review.customer?.id ?? "");
  const [ownerId, setOwnerId] = useState(currentUser.role === "ESTIMATOR" ? currentUser.id : (review.estimators[0]?.id ?? ""));

  const readable = review.sources.filter((s) => !s.storedOnly);
  const activeSource = review.sources.find((s) => s.id === selected?.sourceId) ?? readable[0] ?? null;
  const groups = useMemo(() => {
    const byPart = new Map<string, Field[]>();
    for (const f of review.fields) byPart.set(f.partKey, [...(byPart.get(f.partKey) ?? []), f]);
    return byPart;
  }, [review.fields]);

  const decided = review.fields.filter((f) => f.status !== "PENDING").length;
  const conflicts = review.fields.filter((f) => f.status === "PENDING" && f.conflict).length;
  const dueDecided = review.fields.some((f) => !f.partKey && f.fieldKey === "dueDate" && (f.status === "ACCEPTED" || f.status === "EDITED"));

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Could not save that.");
      else if (success) toast.success(success);
      router.refresh();
    });
  }

  if (running) {
    return (
      <Section title="Reading the documents" description="Each source is read on its own; this usually takes a few seconds.">
        <ul className="flex flex-col gap-2">
          {review.sources.map((s) => {
            const Icon = KIND_ICON[s.kind];
            const st = state[s.id] ?? (s.status === "PENDING" ? "queued" : "done");
            return (
              <li key={s.id} className="flex items-center gap-2.5 text-dense">
                <Icon className="size-4 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {st === "running" ? <Spinner className="text-accent" label="Reading" /> : st === "failed" ? <span className="text-danger">failed</span> : st === "queued" ? <span className="text-ink-3">queued</span> : <Check className="size-4 text-ok" aria-label="Done" />}
              </li>
            );
          })}
        </ul>
      </Section>
    );
  }

  const excelSources = review.sources.filter((s) => s.kind === "EXCEL" && s.excel);
  const missingDue = !review.fields.some((f) => !f.partKey && f.fieldKey === "dueDate");

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <AiBanner review={review} />

        {excelSources.map((s) => (
          <Section key={s.id} title={`Part list columns — ${s.label}`} description="Values read from cells need no AI. Confirm a column once to accept every value in it.">
            <ul className="flex flex-wrap gap-2">
              {s.excel!.mapped.map((m) => {
                const open = review.fields.some((f) => f.status === "PENDING" && !f.conflict && f.proposedValue && f.candidates.some((c) => c.sourceId === s.id && c.column?.letter === m.letter && c.value === f.proposedValue));
                return (
                  <li key={m.letter}>
                    <Button size="sm" disabled={!open || pending} onClick={() => act(() => acceptColumnAction({ sessionId: review.id, sourceId: s.id, letter: m.letter }), `Column ${m.letter} confirmed.`)}>
                      {open ? <Check /> : null}
                      {m.header} <span className="text-ink-3">({m.letter})</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
            {s.excel!.unmapped.length ? <p className="mt-2 text-xs text-ink-3">Not used: {s.excel!.unmapped.join(", ")}</p> : null}
          </Section>
        ))}

        {[...groups.entries()].map(([partKey, fields]) => {
          const agreed = fields.filter((f) => f.status === "PENDING" && f.agreed && !f.conflict && f.proposedValue).length;
          const label = partKey ? (fields[0]?.partLabel ?? partKey) : "Enquiry";
          return (
            <Section
              key={partKey || "rfq"}
              title={partKey ? `Part · ${label}` : "Enquiry"}
              description={partKey ? <span className="font-mono">{partKey}</span> : "Customer, reference and due date."}
              actions={
                agreed > 0 ? (
                  <Button size="sm" onClick={() => act(() => acceptAgreedAction({ sessionId: review.id, partKey }), `${agreed} agreed value(s) accepted.`)} disabled={pending}>
                    Accept {agreed} where sources agree
                  </Button>
                ) : null
              }
              flush
            >
              <ul className="divide-y divide-line">
                {fields.map((f) => (
                  <FieldRow key={f.id} field={f} sessionId={review.id} busy={pending} onAct={act} onShowSource={(c) => setSelected({ sourceId: c.sourceId.split(":")[0]!, locator: c.locator })} />
                ))}
                {!partKey && missingDue ? <TypedRow sessionId={review.id} partKey="" fieldKey="dueDate" onAct={act} /> : null}
              </ul>
            </Section>
          );
        })}
        {review.fields.length === 0 ? (
          <Notice tone="warn" title="Nothing could be read from these documents">
            Type the due date below, then add the part details on the RFQ.
          </Notice>
        ) : null}
        {review.fields.length === 0 ? (
          <Section title="Enquiry" flush>
            <ul className="divide-y divide-line">
              <TypedRow sessionId={review.id} partKey="" fieldKey="dueDate" onAct={act} />
              <TypedRow sessionId={review.id} partKey="PART-1" fieldKey="description" onAct={act} />
              <TypedRow sessionId={review.id} partKey="PART-1" fieldKey="annualVolume" onAct={act} />
            </ul>
          </Section>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-4" aria-label="Sources">
        <SourcePane sources={review.sources} active={activeSource} highlight={selected?.locator ?? null} onSelect={(id) => setSelected({ sourceId: id, locator: null })} />
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-14 2xl:left-56">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="mr-auto text-dense">
            <span className="font-medium">
              {decided} of {review.fields.length} decided
            </span>
            {conflicts ? <span className="text-danger"> · {conflicts} conflict{conflicts > 1 ? "s" : ""}</span> : null}
            {!dueDecided ? <span className="text-warn"> · due date not decided</span> : null}
          </p>
          <Select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-44">
            <option value="">Customer…</option>
            {review.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-44">
            {review.estimators.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            onClick={() =>
              startTransition(async () => {
                await discardIntakeAction({ sessionId: review.id });
                router.push("/rfqs");
              })
            }
          >
            Discard
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!customerId || !ownerId || !dueDecided}
            onClick={() =>
              startTransition(async () => {
                const res = await createRfqFromIntakeAction({ sessionId: review.id, customerId, ownerId });
                if (!res.ok) return void toast.error(res.error);
                toast.success(`${res.data.number} created.`);
                router.push(`/rfqs/${res.data.rfqId}`);
              })
            }
          >
            Create RFQ
          </Button>
        </div>
      </div>
    </div>
  );
}

function AiBanner({ review }: { review: IntakeReview }) {
  const ai = review.sources.filter((s) => s.mode === "AI");
  const rules = review.sources.filter((s) => s.mode === "RULES");
  const failed = review.sources.filter((s) => s.status === "FAILED" || s.status === "NO_TEXT");
  return (
    <div className="flex flex-col gap-2">
      {ai.length ? (
        <Notice tone="ai" title={`Read by ${review.aiModel ?? ai[0]!.model} — check every value`}>
          The AI only transcribes; each value is checked against the text it came from. {ai.some((s) => s.cachedAt) ? "Some results come from the extraction cache (same document, same model)." : null}
        </Notice>
      ) : null}
      {rules.length ? (
        <Notice tone="warn" title="Rule-based reading">
          {review.fallbackReason ?? "Only labelled values were found."} Values read by rules are at most Medium confidence.
        </Notice>
      ) : null}
      {failed.map((s) => (
        <Notice key={s.id} tone="danger" title={`${s.label} could not be read`}>
          {s.error}
        </Notice>
      ))}
    </div>
  );
}

function FieldRow({
  field: f,
  sessionId,
  busy,
  onAct,
  onShowSource,
}: {
  field: Field;
  sessionId: string;
  busy: boolean;
  onAct: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  onShowSource: (c: Candidate) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.proposedValue ?? "");
  const [choice, setChoice] = useState<string | null>(null);
  const best = f.candidates.find((c) => c.value === (f.finalValue ?? f.proposedValue)) ?? f.candidates[0];
  const decided = f.status !== "PENDING";
  const ungrounded = !decided && !f.conflict && f.proposedValue === null && f.candidates.length > 0;
  const decide = (action: "ACCEPT" | "EDIT" | "REJECT" | "UNDO", v: string | null = null) => onAct(() => decideFieldAction({ sessionId, fieldId: f.id, action, value: v }));

  return (
    <li className={cn("grid gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto]", !decided && "border-l-2 border-l-ai")}>
      <div className="text-dense font-medium text-ink-2">
        {f.label}
        {f.required ? <span className="text-danger"> *</span> : null}
      </div>

      <div className="min-w-0">
        {editing ? (
          <div className="flex gap-2">
            <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (decide("EDIT", value), setEditing(false))} aria-label={`${f.label} value`} />
            <Button size="sm" variant="primary" onClick={() => (decide("EDIT", value), setEditing(false))}>
              Save
            </Button>
          </div>
        ) : f.conflict && !decided ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Choose the right value</legend>
            {[...new Map(f.candidates.filter((c) => c.grounded).map((c) => [c.value, c])).values()].map((c) => (
              <label key={c.value} className="flex items-center gap-2 text-dense">
                <input type="radio" name={`c-${f.id}`} checked={choice === c.value} onChange={() => setChoice(c.value)} className="accent-[var(--color-accent)]" />
                <span className="font-medium">{show(f.type, c.value)}</span>
                <button type="button" onClick={() => onShowSource(c)} className="text-xs text-ink-3 underline-offset-2 hover:underline">
                  {c.sourceLabel}
                  {c.locator ? ` · ${c.locator}` : ""}
                </button>
              </label>
            ))}
          </fieldset>
        ) : ungrounded ? (
          <p className="text-dense text-ink-3">
            <span className="text-danger">AI read “{best?.display}” — not found in the source.</span>{" "}
            <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => decide("EDIT", best?.value ?? "")}>
              Use anyway
            </button>
          </p>
        ) : (
          <p className={cn("text-sm", decided && f.status === "REJECTED" && "text-ink-3 line-through")}>{show(f.type, f.finalValue ?? f.proposedValue)}</p>
        )}

        {!editing && best ? (
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
            <button type="button" onClick={() => onShowSource(best)} className="underline-offset-2 hover:text-ink hover:underline">
              {best.sourceLabel}
              {best.locator ? ` · ${best.locator}` : ""}
            </button>
            {best.evidence ? <span className="max-w-[48ch] truncate font-mono">“{best.evidence}”</span> : null}
            {f.confidence !== "HIGH" || f.conflict ? (
              <span className={CONFIDENCE_TONE[f.confidence]}>
                {f.conflict ? "Conflict" : f.confidence === "MEDIUM" ? "Medium" : "Low"} — {f.reason?.replace(" · agreed", "")}
              </span>
            ) : f.agreed ? (
              <Chip tone="ok">sources agree</Chip>
            ) : null}
          </p>
        ) : null}
        {decided ? (
          <p className="mt-0.5 text-xs text-ink-3">
            {f.status === "ACCEPTED" ? "Accepted" : f.status === "EDITED" ? "Edited" : "Rejected"}
            {f.decidedVia === "COLUMN" ? " by column" : f.decidedVia === "AGREED" ? " (sources agree)" : ""} · {f.decidedBy}
          </p>
        ) : null}
      </div>

      <div className="flex items-start gap-1">
        {decided ? (
          <Button size="sm" variant="ghost" onClick={() => decide("UNDO")} disabled={busy} aria-label={`Undo ${f.label}`}>
            <RotateCcw /> Undo
          </Button>
        ) : (
          <>
            {f.conflict ? (
              <Button size="sm" variant="primary" onClick={() => choice && decide("ACCEPT", choice)} disabled={!choice || busy}>
                Use this
              </Button>
            ) : f.proposedValue ? (
              <Button size="sm" onClick={() => decide("ACCEPT")} disabled={busy} aria-label={`Accept ${f.label}`}>
                <Check /> Accept
              </Button>
            ) : null}
            <Button size="icon" variant="ghost" onClick={() => (setValue(f.proposedValue ?? best?.value ?? ""), setEditing(true))} aria-label={`Edit ${f.label}`} title="Edit">
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => decide("REJECT")} disabled={busy} aria-label={`Reject ${f.label}`} title="Reject">
              <X />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function TypedRow({ sessionId, partKey, fieldKey, onAct }: { sessionId: string; partKey: string; fieldKey: string; onAct: (fn: () => Promise<{ ok: boolean; error?: string }>) => void }) {
  const [value, setValue] = useState("");
  const spec = FIELDS.find((f) => f.key === fieldKey)!;
  return (
    <li className="grid gap-x-3 gap-y-1 border-l-2 border-l-warn px-4 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
      <div className="text-dense font-medium text-ink-2">
        {spec.label} <span className="text-danger">*</span>
      </div>
      <div>
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={fieldKey === "dueDate" ? "e.g. 16/11/2026" : ""} aria-label={spec.label} />
        <p className="mt-0.5 text-xs text-warn">Not found in the documents — type it.</p>
      </div>
      <Button size="sm" variant="primary" disabled={!value.trim()} onClick={() => onAct(() => addTypedFieldAction({ sessionId, partKey, fieldKey, value }))}>
        Save
      </Button>
    </li>
  );
}

function SourcePane({ sources, active, highlight, onSelect }: { sources: Source[]; active: Source | null; highlight: string | null; onSelect: (id: string) => void }) {
  const line = highlight?.startsWith("line ") ? Number(highlight.slice(5)) : null;
  const lineRef = useRef<HTMLLIElement>(null);
  useEffect(() => lineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), [line, active?.id]);

  return (
    <Section title="Sources" flush>
      <ul className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2.5">
        {sources.map((s) => {
          const Icon = KIND_ICON[s.kind];
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn("inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs", active?.id === s.id ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {active ? (
        <div className="max-h-[60vh] overflow-auto px-3 py-3 text-dense">
          <p className="mb-2 text-xs text-ink-3">
            {active.mode === "AI" ? (
              <>
                <Sparkles className="mr-1 inline size-3" aria-hidden />
                Read by {active.model}
                {active.sentChars ? ` · ${active.sentChars.toLocaleString("en-IN")} characters sent` : ""}
                {active.usedRegion === "title-block" ? " · title block only" : ""}
                {active.cachedAt ? " · cached result" : ""}
              </>
            ) : active.mode === "RULES" ? (
              "Read by rules"
            ) : active.mode === "PARSER" ? (
              "Read cell by cell"
            ) : active.storedOnly ? (
              "Stored with the RFQ; not read"
            ) : (
              active.error ?? ""
            )}
          </p>
          {active.kind === "DRAWING_IMAGE" && active.fileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${active.fileId}?inline=1`} alt={`Title block of ${active.label}`} className="mb-3 w-full rounded border border-line" />
          ) : null}
          {active.kind === "DRAWING_PDF" && active.fileId ? (
            <a href={`/api/files/${active.fileId}?inline=1`} target="_blank" rel="noopener" className="mb-2 inline-block text-xs text-accent hover:underline">
              Open the drawing (logged)
            </a>
          ) : null}
          {active.kind === "EXCEL" && active.excel ? (
            <p className="text-ink-2">
              Sheet “{active.excel.sheet}”, header on row {active.excel.headerRow}, {active.excel.rows} part row(s). Columns used: {active.excel.mapped.map((m) => `${m.header} (${m.letter})`).join(", ")}.
            </p>
          ) : null}
          {active.text ? (
            <ol className="font-mono text-xs leading-relaxed">
              {active.text.split("\n").map((raw, i) => {
                const n = i + 1;
                const text = raw.replace(/^L\d{3}: ?/, "");
                const hit = line === n;
                return (
                  <li key={i} ref={hit ? lineRef : undefined} className={cn("grid grid-cols-[2.5rem_1fr] gap-2 rounded px-1", hit && "bg-[#FDF0C2]")}>
                    <span className="text-right text-ink-4 select-none">{active.kind === "EMAIL" || active.kind === "PASTED_TEXT" ? n : ""}</span>
                    <span className="break-words whitespace-pre-wrap">{text || " "}</span>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {active.hints.length ? <p className="mt-3 text-xs text-ink-3">Drawing notes (read locally, not sent): {active.hints.join(", ")}</p> : null}
        </div>
      ) : (
        <p className="px-3 py-4 text-dense text-ink-3">No sources.</p>
      )}
    </Section>
  );
}
