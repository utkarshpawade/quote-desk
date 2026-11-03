"use client";

import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import type { CatalogOption, OperationDraft } from "@/domain/costing/draft";
import { operationKindForUnit } from "@/domain/costing/draft";
import type { CostingIssue, OperationResult } from "@/domain/costing/types";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export function newRowId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

const UNIT = { PER_HOUR: "/h", PER_KG: "/kg", PER_PIECE: "/pc" } as Record<string, string>;

export function rateLabel(o: CatalogOption): string {
  if (!o.ref) return "no rate on basis date";
  const whole = Number.isInteger(Number(o.ref.value));
  return `₹${formatNumber(o.ref.value, whole ? 0 : 2)}${UNIT[o.unit] ?? ""}`;
}

const cell =
  "h-8 w-full min-w-0 rounded border border-control bg-surface px-2 text-dense outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 aria-invalid:border-danger";

function WorkCentreSelect({ value, options, onChange, disabled, invalid }: { value: string | null; options: CatalogOption[]; onChange: (id: string) => void; disabled?: boolean; invalid?: boolean }) {
  const groups: Array<[string, CatalogOption[]]> = [
    ["Machines · ₹ per hour", options.filter((o) => o.category === "MACHINE")],
    ["Processes · ₹ per kg", options.filter((o) => o.category === "PROCESS" && o.unit === "PER_KG")],
    ["Processes · ₹ per piece", options.filter((o) => o.category === "PROCESS" && o.unit === "PER_PIECE")],
  ];
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={invalid || undefined} aria-label="Work centre" className={cn(cell, "pr-6")}>
      <option value="" disabled>
        Choose…
      </option>
      {groups.map(([label, items]) => (
        <optgroup key={label} label={label}>
          {items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name.replace(/ \(job work\)$/, "")} · {rateLabel(o)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function RoutingTable(props: {
  operations: OperationDraft[];
  options: CatalogOption[];
  results: OperationResult[];
  issues: CostingIssue[];
  editable: boolean;
  hasForged: boolean;
  suggestedFromLabel: (id: string | null) => string | null;
  onChange: (ops: OperationDraft[]) => void;
  setupPerBatch: string | null;
}) {
  const { operations, options, editable } = props;
  const byId = new Map(options.map((o) => [o.id, o]));
  const issueFor = (opId: string, field: string) => props.issues.find((i) => i.field === `operations.${opId}.${field}` && i.severity === "error");
  const warnFor = (opId: string, field: string) => props.issues.find((i) => i.field === `operations.${opId}.${field}` && i.severity === "warning");

  function patch(index: number, change: Partial<OperationDraft>) {
    props.onChange(operations.map((op, i) => (i === index ? { ...op, ...change, confirmed: change.confirmed ?? (op.confirmed || ("cycleTimeMin" in change)) } : op)));
  }

  function chooseItem(index: number, itemId: string) {
    const option = byId.get(itemId);
    if (!option) return;
    const op = operations[index]!;
    const kind = operationKindForUnit(option.unit);
    const previousName = op.itemId ? byId.get(op.itemId)?.name : null;
    const basis = option.defaultWeightBasis === "FORGED" && !props.hasForged ? "GROSS" : (option.defaultWeightBasis ?? "GROSS");
    patch(index, {
      itemId,
      kind,
      name: !op.name || op.name === previousName ? option.name.replace(/ \(job work\)$/, "") : op.name,
      cycleTimeMin: kind === "MACHINE" ? op.cycleTimeMin : null,
      setupMin: kind === "MACHINE" ? (op.setupMin ?? "0") : null,
      weightBasis: kind === "PROCESS_KG" ? (op.weightBasis ?? basis) : null,
      legacyName: null,
    });
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...operations];
    const [op] = next.splice(index, 1);
    next.splice(index + delta, 0, op!);
    props.onChange(next);
  }

  function add() {
    props.onChange([
      ...operations,
      { id: newRowId(), name: "", itemId: null, kind: "MACHINE", cycleTimeMin: null, setupMin: "0", weightBasis: null, suggestedFromId: null, legacyName: null, confirmed: true },
    ]);
  }

  const total = props.results.reduce((acc, r) => acc + (r.costPerPiece ? Number(r.costPerPiece) : 0), 0);

  return (
    <div>
      {/* Desktop grid */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-dense">
          <colgroup>
            <col className="w-7" />
            <col className="w-[24%]" />
            <col />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
            {editable ? <col className="w-[84px]" /> : null}
          </colgroup>
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th className="py-1.5 text-left font-medium">#</th>
              <th className="py-1.5 text-left font-medium">Operation</th>
              <th className="px-1 py-1.5 text-left font-medium">Work centre</th>
              <th className="px-1 py-1.5 text-right font-medium">Cycle min</th>
              <th className="px-1 py-1.5 text-right font-medium">Setup min</th>
              <th className="px-1 py-1.5 text-right font-medium">₹ / pc</th>
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {operations.map((op, i) => {
              const result = props.results.find((r) => r.id === op.id);
              const suggested = !op.confirmed;
              const from = props.suggestedFromLabel(op.suggestedFromId);
              return (
                <tr key={op.id} className={cn("border-b border-line align-top", suggested && "bg-ai-soft/40")}>
                  <td className={cn("py-1.5 pr-1 text-ink-3", suggested && "border-l-2 border-ai pl-1")}>{(i + 1) * 10}</td>
                  <td className="py-1 pr-1">
                    {editable ? (
                      <input value={op.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder={op.legacyName ?? "Operation"} aria-label={`Operation ${i + 1} name`} className={cell} />
                    ) : (
                      <span className="block py-1.5">{op.name}</span>
                    )}
                    {from || op.legacyName ? (
                      <span className="mt-0.5 block truncate text-xs text-ai">
                        {from ? `from ${from}` : ""}
                        {op.legacyName && !op.itemId ? ` · was “${op.legacyName}” — choose a work centre` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1 py-1">
                    {editable ? (
                      <>
                        <WorkCentreSelect value={op.itemId} options={options} onChange={(id) => chooseItem(i, id)} invalid={Boolean(issueFor(op.id, "rate"))} />
                        {op.itemId && byId.get(op.itemId)?.category === "PROCESS" ? (
                          <span className="mt-0.5 block truncate text-xs text-ink-3">{byId.get(op.itemId)!.inHouse ? "In-house — attracts overhead" : "Job work — no overhead"}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="block truncate py-1.5 text-ink-2">{op.itemId ? `${byId.get(op.itemId)?.name ?? ""} · ${byId.get(op.itemId) ? rateLabel(byId.get(op.itemId)!) : ""}` : "—"}</span>
                    )}
                  </td>
                  {op.kind === "MACHINE" ? (
                    <>
                      <td className="px-1 py-1">
                        {editable ? (
                          <input
                            inputMode="decimal"
                            value={op.cycleTimeMin ?? ""}
                            onChange={(e) => patch(i, { cycleTimeMin: e.target.value || null })}
                            aria-label={`Cycle time, operation ${i + 1}`}
                            aria-invalid={Boolean(issueFor(op.id, "cycleTimeMin")) || undefined}
                            className={cn(cell, "num text-right", suggested && "border-ai", warnFor(op.id, "cycleTimeMin") && "border-warn")}
                          />
                        ) : (
                          <span className="num block py-1.5 text-right">{op.cycleTimeMin ? Number(op.cycleTimeMin) : "—"}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {editable ? (
                          <input inputMode="decimal" value={op.setupMin ?? ""} onChange={(e) => patch(i, { setupMin: e.target.value || null })} aria-label={`Setup time, operation ${i + 1}`} className={cn(cell, "num text-right")} />
                        ) : (
                          <span className="num block py-1.5 text-right">{op.setupMin ? Number(op.setupMin) : "—"}</span>
                        )}
                      </td>
                    </>
                  ) : op.kind === "PROCESS_KG" ? (
                    <td colSpan={2} className="px-1 py-1">
                      {editable ? (
                        <label className="flex items-center justify-end gap-1.5 text-xs text-ink-3">
                          on
                          <select value={op.weightBasis ?? ""} onChange={(e) => patch(i, { weightBasis: e.target.value as OperationDraft["weightBasis"] })} aria-label="Charged on weight" aria-invalid={Boolean(issueFor(op.id, "weightBasis")) || undefined} className={cn(cell, "w-24 px-1")}>
                            <option value="GROSS">gross</option>
                            <option value="FORGED" disabled={!props.hasForged}>
                              forged
                            </option>
                            <option value="NET">net</option>
                          </select>
                          weight
                        </label>
                      ) : (
                        <span className="block py-1.5 text-right text-xs text-ink-3">on {op.weightBasis?.toLowerCase()} weight</span>
                      )}
                    </td>
                  ) : (
                    <td colSpan={2} className="px-1 py-1.5 text-right text-xs text-ink-3">
                      per piece
                    </td>
                  )}
                  <td className="num px-1 py-1.5 text-right font-medium">{result?.costPerPiece ? formatNumber(result.costPerPiece, 2) : <span className="text-ink-4">—</span>}</td>
                  {editable ? (
                    <td className="py-1 pl-1">
                      <div className="flex justify-end">
                        {suggested ? (
                          <button type="button" onClick={() => patch(i, { confirmed: true })} className="flex size-7 items-center justify-center rounded text-ai hover:bg-ai-soft" title="Confirm this operation" aria-label={`Confirm operation ${i + 1}`}>
                            <Check className="size-4" />
                          </button>
                        ) : null}
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover disabled:opacity-30" aria-label={`Move operation ${i + 1} up`}>
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === operations.length - 1} className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover disabled:opacity-30" aria-label={`Move operation ${i + 1} down`}>
                          <ArrowDown className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => props.onChange(operations.filter((_, j) => j !== i))} className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`Remove operation ${i + 1}`}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per operation */}
      <ul className="flex flex-col gap-2 md:hidden">
        {operations.map((op, i) => {
          const result = props.results.find((r) => r.id === op.id);
          return (
            <li key={op.id} className={cn("rounded-md border border-line p-2.5", !op.confirmed && "border-l-2 border-l-ai")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {(i + 1) * 10} · {op.name || op.legacyName || "Operation"}
                </span>
                <span className="num font-medium">{result?.costPerPiece ? `₹${formatNumber(result.costPerPiece, 2)}` : "—"}</span>
              </div>
              {editable ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <WorkCentreSelect value={op.itemId} options={options} onChange={(id) => chooseItem(i, id)} />
                  </div>
                  {op.kind === "MACHINE" ? (
                    <>
                      <label className="text-xs text-ink-3">
                        Cycle min
                        <input inputMode="decimal" value={op.cycleTimeMin ?? ""} onChange={(e) => patch(i, { cycleTimeMin: e.target.value || null })} className={cn(cell, "num mt-0.5 h-10 text-right")} />
                      </label>
                      <label className="text-xs text-ink-3">
                        Setup min / batch
                        <input inputMode="decimal" value={op.setupMin ?? ""} onChange={(e) => patch(i, { setupMin: e.target.value || null })} className={cn(cell, "num mt-0.5 h-10 text-right")} />
                      </label>
                    </>
                  ) : op.kind === "PROCESS_KG" ? (
                    <label className="col-span-2 text-xs text-ink-3">
                      Charged on
                      <select value={op.weightBasis ?? ""} onChange={(e) => patch(i, { weightBasis: e.target.value as OperationDraft["weightBasis"] })} className={cn(cell, "mt-0.5 h-10")}>
                        <option value="GROSS">gross weight</option>
                        <option value="FORGED" disabled={!props.hasForged}>
                          forged weight
                        </option>
                        <option value="NET">net weight</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-ink-3">
                  {op.itemId && byId.get(op.itemId) ? `${byId.get(op.itemId)!.name} · ${rateLabel(byId.get(op.itemId)!)}` : "—"}
                  {op.kind === "MACHINE" && op.cycleTimeMin ? ` · ${Number(op.cycleTimeMin)} min` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {editable ? (
          <button type="button" onClick={add} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-dense text-accent hover:bg-accent-soft">
            <Plus className="size-4" /> Add operation
          </button>
        ) : (
          <span />
        )}
        <p className="text-xs text-ink-3">
          Process <span className="num text-ink-2">₹{formatNumber(total.toFixed(2), 2)}</span>/pc · setup{" "}
          <span className="num text-ink-2">₹{props.setupPerBatch ? formatNumber(props.setupPerBatch, 2) : "0.00"}</span> per batch
        </p>
      </div>
    </div>
  );
}
