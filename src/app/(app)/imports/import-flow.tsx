"use client";

import { AlertCircle, AlertTriangle, Check, FileSpreadsheet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatInteger, formatNumber } from "@/lib/format";
import type { ImportAnalysis, ImportResult } from "@/server/services/past-quote-import";

type Source = { kind: "file"; file: File } | { kind: "sample"; key: string; label: string };

type State =
  | { step: "idle" }
  | { step: "reading"; source: Source }
  | { step: "review"; source: Source; analysis: ImportAnalysis }
  | { step: "importing"; source: Source; analysis: ImportAnalysis };

const OUTCOME_LABEL: Record<string, string> = { WON: "Won", LOST: "Lost", NO_RESPONSE: "No response", OPEN: "Open", REGRETTED: "Regretted" };

async function send<T>(source: Source, mode: "analyze" | "import"): Promise<T> {
  const form = new FormData();
  form.set("mode", mode);
  if (source.kind === "file") form.set("file", source.file);
  else form.set("sample", source.key);
  const res = await fetch("/api/imports/past-quotes", { method: "POST", body: form });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "The import service did not respond. Try again.");
  return body;
}

/** Upload → dry-run report → import. Nothing is written until "Import". */
export function ImportFlow({ samples }: { samples: Array<{ key: string; label: string }> }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function analyze(source: Source) {
    setError(null);
    setState({ step: "reading", source });
    try {
      setState({ step: "review", source, analysis: await send<ImportAnalysis>(source, "analyze") });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState({ step: "idle" });
    }
  }

  async function commit() {
    if (state.step !== "review") return;
    setState({ ...state, step: "importing" });
    try {
      const r = await send<ImportResult>(state.source, "import");
      toast.success(`Imported ${formatInteger(r.imported)} past quotes`, {
        description: [r.skipped ? `${formatInteger(r.skipped)} already there or duplicated` : null, r.failed ? `${r.failed} rows with errors left out` : null].filter(Boolean).join(" · ") || undefined,
      });
      setState({ step: "idle" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState({ ...state, step: "review" });
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) void analyze({ kind: "file", file });
  }

  if (state.step === "idle" || state.step === "reading") {
    const reading = state.step === "reading";
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Notice tone="danger" title="This file could not be imported">
            {error}
          </Notice>
        ) : null}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!reading) pick(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center transition-colors",
            dragging && "border-accent bg-accent-soft",
          )}
        >
          {reading ? (
            <>
              <Spinner className="mb-3 text-accent" label="Reading" />
              <p className="text-sm font-medium">Reading {state.source.kind === "file" ? state.source.file.name : state.source.label}…</p>
              <p className="mt-1 text-dense text-ink-3">Checking every row. Nothing is saved yet.</p>
            </>
          ) : (
            <>
              <FileSpreadsheet className="mb-3 size-6 text-ink-4" strokeWidth={1.5} aria-hidden />
              <p className="text-sm font-medium">Drop the quote register here</p>
              <p className="mt-1 max-w-md text-dense text-ink-3">Excel (.xlsx, .xls) or CSV, up to 4 MB. You will see a row-by-row report before anything is imported.</p>
              <Button className="mt-4" variant="primary" onClick={() => input.current?.click()}>
                <Upload /> Choose file
              </Button>
              <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => pick(e.target.files)} aria-label="Quote register file" />
            </>
          )}
        </div>
        {!reading ? (
          <div className="flex flex-wrap items-center gap-2 text-dense text-ink-3">
            <span>Or try a sample file:</span>
            {samples.map((s) => (
              <Button key={s.key} size="sm" onClick={() => void analyze({ kind: "sample", key: s.key, label: s.label })}>
                {s.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const { analysis } = state;
  const c = analysis.counts;
  const importing = state.step === "importing";
  const errors = analysis.issues.filter((i) => i.severity === "error").length;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Notice tone="danger" title="Import failed">
          {error}
        </Notice>
      ) : null}
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{analysis.filename}</p>
            <p className="text-dense text-ink-3">
              Sheet “{analysis.sheet}”, headers in row {analysis.headerRow} · {formatInteger(c.rows)} rows read
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setState({ step: "idle" })} disabled={importing}>
              Choose another file
            </Button>
            <Button variant="primary" onClick={() => void commit()} loading={importing} disabled={c.ready === 0}>
              {c.ready === 0 ? "Nothing new to import" : `Import ${formatInteger(c.ready)} row${c.ready === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>

        {analysis.sameFile ? (
          <Notice tone="info" className="mx-4 mt-3">
            This exact file was imported on {formatDateTime(analysis.sameFile.at)} by {analysis.sameFile.by}. Rows already imported are skipped, so importing again adds nothing twice.
          </Notice>
        ) : null}

        <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {(
            [
              ["New, ready to import", c.ready, "text-ok"],
              ["Already imported", c.existing, "text-ink-2"],
              ["Duplicates in the file", c.duplicates, "text-ink-2"],
              ["Left out (errors)", c.failed, c.failed ? "text-danger" : "text-ink-2"],
            ] as const
          ).map(([label, n, tone]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className={cn("num mt-0.5 text-left text-lg font-semibold", tone)}>{formatInteger(n)}</dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 text-xs font-medium text-ink-3">Columns</p>
          <div className="flex flex-wrap gap-1.5">
            {analysis.columns.map((col) =>
              col.header ? (
                <Chip key={col.field} tone="ok" title={`${col.label} ← column ${col.letter} “${col.header}”`}>
                  <Check className="size-3" aria-hidden /> {col.label} <span className="text-ink-3">({col.letter})</span>
                </Chip>
              ) : (
                <Chip key={col.field} tone="neutral" title="Not in this file — imported as blank">
                  {col.label}: not in file
                </Chip>
              ),
            )}
            {analysis.unmapped.map((h) => (
              <Chip key={h} tone="warn" title="This column is not used">
                ignored: {h}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {analysis.issues.length ? (
        <section className="rounded-lg border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Row report</h2>
            <p className="text-dense text-ink-3">
              {errors} row problem{errors === 1 ? "" : "s"} keep rows out; {c.warnings} warning{c.warnings === 1 ? "" : "s"} import the row without the doubtful value. Fix the file and import it again — rows
              already imported are skipped.
            </p>
          </header>
          <TableScroll className="max-h-[420px] overflow-y-auto">
            <Table>
              <thead className="sticky top-0">
                <tr>
                  <Th className="w-16">Row</Th>
                  <Th className="w-16">Cell</Th>
                  <Th>Problem</Th>
                </tr>
              </thead>
              <tbody>
                {analysis.issues.map((i, n) => (
                  <Tr key={n}>
                    <Td className="num text-left">{i.row}</Td>
                    <Td className="font-mono text-xs text-ink-3">{i.cell ?? "—"}</Td>
                    <Td>
                      <span className={cn("inline-flex items-start gap-1.5", i.severity === "error" ? "text-danger" : "text-warn")}>
                        {i.severity === "error" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                        <span>
                          <span className="sr-only">{i.severity === "error" ? "Error: " : "Warning: "}</span>
                          <span className="text-ink">{i.message}</span>
                        </span>
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          {analysis.issuesTruncated ? <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Showing the first {analysis.issues.length} problems.</p> : null}
        </section>
      ) : (
        <Notice tone="ok">Every row passed the checks.</Notice>
      )}

      {analysis.preview.length ? (
        <section className="rounded-lg border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">First rows to import</h2>
          </header>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Quote</Th>
                  <Th>Customer</Th>
                  <Th>Part</Th>
                  <Th>Material</Th>
                  <Th numeric>₹/pc</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {analysis.preview.map((r) => (
                  <Tr key={r.row}>
                    <Td className="num text-left text-ink-3">{r.row}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="font-mono text-dense">{r.refNo}</span>
                      <div className="text-xs text-ink-3">{formatDate(r.quoteDate)}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{r.customerName}</Td>
                    <Td>
                      {r.description}
                      {r.partNo ? <div className="font-mono text-xs text-ink-3">{r.partNo}</div> : null}
                    </Td>
                    <Td>{r.materialText ?? "—"}</Td>
                    <Td numeric>{formatNumber(r.unitPrice, 2)}</Td>
                    <Td>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </section>
      ) : null}
    </div>
  );
}
