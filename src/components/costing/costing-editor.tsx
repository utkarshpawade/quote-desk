"use client";

import { AlertCircle, ArrowLeft, ArrowRight, Check, CircleAlert, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveCostingAction } from "@/app/(app)/rfqs/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NumberInput, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/page";
import { Notice } from "@/components/ui/states";
import { contextFromOptions, draftToCostingInput, operationKindForUnit, type CatalogOption, type LineDraft, type OperationDraft } from "@/domain/costing/draft";
import { computeCosting } from "@/domain/costing/engine";
import type { CostingIssue } from "@/domain/costing/types";
import { processHints } from "@/domain/intake/process-hints";
import { cn } from "@/lib/cn";
import { formatDateTime, formatINR, formatInteger, formatNumber } from "@/lib/format";
import type { RoutingSuggestion, SimilarForCosting } from "@/server/services/past-quotes";
import type { CostingView } from "@/server/services/quotes";
import { BreakupPanel } from "./breakup-panel";
import { ProvenanceCaption } from "./provenance";
import { newRowId, rateLabel, RoutingTable } from "./routing-table";
import { RoutingSuggestions } from "./routing-suggestions";

type SaveState =
  | { kind: "saved"; at: string | null }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string };

/** Debounced autosave with at most one request in flight; later edits are sent after it lands. */
function useAutosave(lineId: string, initialLock: number, enabled: boolean) {
  const [state, setState] = useState<SaveState>({ kind: "saved", at: null });
  const lock = useRef(initialLock);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<LineDraft | null>(null);

  const flush = useCallback(
    async (first: LineDraft) => {
      if (inFlight.current) {
        queued.current = first;
        return;
      }
      inFlight.current = true;
      // Keep saving while newer edits arrived during the previous request.
      let draft: LineDraft | null = first;
      while (draft) {
        setState({ kind: "saving" });
        const res = await saveCostingAction({ lineId, lockVersion: lock.current, draft });
        if (res.ok) {
          lock.current = res.data.lockVersion;
          setState({ kind: "saved", at: res.data.savedAt });
        } else if (/changed by someone else/i.test(res.error)) {
          setState({ kind: "conflict", message: res.error });
          queued.current = null;
          break;
        } else {
          setState({ kind: "error", message: res.fieldErrors ? `${res.error} ${Object.values(res.fieldErrors)[0] ?? ""}` : res.error });
        }
        draft = queued.current;
        queued.current = null;
      }
      inFlight.current = false;
    },
    [lineId],
  );

  const schedule = useCallback(
    (draft: LineDraft) => {
      if (!enabled) return;
      setState((s) => (s.kind === "conflict" ? s : { kind: "pending" }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(draft), 700);
    },
    [enabled, flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state.kind === "pending" || state.kind === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.kind]);

  return { state, schedule };
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "saving" || state.kind === "pending") return <span className="text-ink-3">Saving…</span>;
  if (state.kind === "error") return <span className="text-danger">Not saved — {state.message}</span>;
  if (state.kind === "conflict") return <span className="text-danger">Changed elsewhere — reload to continue</span>;
  return <span className="text-ink-3">{state.at ? `Saved ${formatDateTime(state.at).split(", ")[1]}` : "All changes saved"}</span>;
}

const issueFor = (issues: CostingIssue[], field: string) => issues.find((i) => i.field === field && i.severity === "error");

/** "0.610" → "0.61", "15.000" → "15": stored values carry the column scale, people don't type it. */
function trim(value: string | null): string | null {
  return value === null ? null : value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function forEditing(draft: LineDraft): LineDraft {
  return {
    ...draft,
    grossWeightKg: trim(draft.grossWeightKg),
    forgedWeightKg: trim(draft.forgedWeightKg),
    netWeightKg: trim(draft.netWeightKg),
    scaleLossPct: trim(draft.scaleLossPct),
    rejectionPct: trim(draft.rejectionPct) ?? draft.rejectionPct,
    toolingCost: trim(draft.toolingCost) ?? draft.toolingCost,
    operations: draft.operations.map((o) => ({ ...o, cycleTimeMin: trim(o.cycleTimeMin), setupMin: trim(o.setupMin) })),
    bop: draft.bop.map((b) => ({ ...b, quantity: trim(b.quantity) ?? b.quantity })),
    tiers: draft.tiers.map((t) => ({ ...t, marginPct: trim(t.marginPct) ?? t.marginPct })),
  };
}

export function CostingEditor(props: {
  view: CostingView;
  similar: SimilarForCosting;
  editable: boolean;
  rfqHref: string;
  prev: { href: string; label: string } | null;
  next: { href: string; label: string } | null;
}) {
  const { view, editable, similar } = props;
  const [draft, setDraft] = useState<LineDraft>(() => forEditing(view.line.draft));
  const { state: save, schedule } = useAutosave(view.line.id, view.line.lockVersion, editable);

  const ctx = useMemo(
    () =>
      contextFromOptions(view.options, {
        overheadPct: view.params.overheadPct,
        iccRatePct: view.params.iccRatePct,
        iccDays: view.params.iccDays,
        marginBasis: view.quote.marginBasis,
      }),
    [view],
  );
  const benchmark = similar.benchmark?.medianConversionPerKg ?? null;
  const result = useMemo(
    () => computeCosting(draftToCostingInput(draft, ctx), { marginFloorPct: view.params.marginFloorPct, similarMedianConversionPerKg: benchmark }),
    [draft, ctx, view.params.marginFloorPct, benchmark],
  );

  function update(change: Partial<LineDraft>) {
    const next = { ...draft, ...change };
    setDraft(next);
    schedule(next);
  }

  const options = (category: CatalogOption["category"]) => view.options.filter((o) => o.category === category);
  const material = view.options.find((o) => o.id === draft.materialItemId);
  const issues = result.issues;
  const errors = issues.filter((i) => i.severity === "error" && i.scope !== "submit");
  const warnings = issues.filter((i) => i.severity === "warning");
  const submitIssues = issues.filter((i) => i.scope === "submit");
  const base = result.baseTierIndex !== null ? result.tiers[result.baseTierIndex] : null;
  const prov = view.provenance;
  const forged = Boolean(draft.forgedWeightKg);
  const unconfirmed = draft.operations.filter((o) => !o.confirmed).length;
  // Drawing processes the routing does not cover yet ("induction hardening" with no IH operation).
  const covered = processHints(draft.operations.map((o) => `${o.name} ${view.options.find((x) => x.id === o.itemId)?.name ?? ""} ${o.legacyName ?? ""}`).join(" | "));
  const uncovered = view.part.processHints.filter((h) => !covered.includes(h));
  // Cycle times copied from a part of very different weight need a second look (> 20 %).
  const copiedFrom = similar.suggestions.find((s) => draft.operations.some((o) => !o.confirmed && o.suggestedFromId === s.id));
  const weightGap =
    copiedFrom?.grossWeightKg && draft.grossWeightKg && Number(draft.grossWeightKg) > 0
      ? (Number(copiedFrom.grossWeightKg) - Number(draft.grossWeightKg)) / Number(draft.grossWeightKg)
      : null;

  function applyRouting(s: RoutingSuggestion) {
    const operations: OperationDraft[] = s.ops.map((op) => {
      const option = op.itemId ? view.options.find((o) => o.id === op.itemId && o.ref) : undefined;
      const kind = option ? operationKindForUnit(option.unit) : op.kind;
      const basis = op.weightBasis ?? option?.defaultWeightBasis ?? "GROSS";
      return {
        id: newRowId(),
        name: (option?.name ?? op.name).replace(/ \(job work\)$/, ""),
        itemId: option?.id ?? null,
        kind,
        cycleTimeMin: kind === "MACHINE" ? op.cycleTimeMin : null,
        setupMin: kind === "MACHINE" ? op.setupMin : null,
        weightBasis: kind === "PROCESS_KG" ? (basis === "FORGED" && !forged ? "GROSS" : basis) : null,
        suggestedFromId: s.id,
        legacyName: option ? null : (op.legacyName ?? op.name),
        confirmed: false,
      };
    });
    update({ operations, routingConfirmed: false });
  }

  function addTier() {
    update({ tiers: [...draft.tiers, { volume: 0, marginPct: view.params.ladder?.basePct ?? "12", isBase: false }] });
  }

  const groupedMaterials = useMemo(() => {
    const groups = new Map<string, CatalogOption[]>();
    for (const o of options("MATERIAL")) groups.set(o.family ?? "Other", [...(groups.get(o.family ?? "Other") ?? []), o]);
    return [...groups];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.options]);

  const familyLabel: Record<string, string> = {
    MEDIUM_CARBON: "Medium-carbon steels",
    ALLOY: "Alloy steels",
    CASE_HARDENING: "Case-hardening steels",
    MICROALLOY: "Micro-alloyed steels",
    FREE_CUTTING: "Free-cutting steels",
  };

  return (
    <div className="flex flex-col gap-4">
      {view.returnNote ? (
        <Notice tone="warn" title="Returned by the sales head">
          “{view.returnNote}”
        </Notice>
      ) : null}
      {view.pendingReview > 0 ? (
        <Notice tone="ai" title={`${view.pendingReview} value${view.pendingReview > 1 ? "s" : ""} from the RFQ documents still need your decision`}>
          They were not filled in. Decide them in the intake review before submitting.
        </Notice>
      ) : null}
      {!view.quote.editable ? (
        <Notice tone="info">
          {view.quote.status === "DRAFT" ? "Read-only: only estimators edit costings." : "This quote has been submitted; the costing is frozen. Start a revision to change it."}
        </Notice>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_clamp(400px,30vw,480px)]">
        {/* ── inputs ── */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold">
              {view.part.lineNo}. {view.part.description}
            </h2>
            <span className="font-mono text-dense text-ink-3">{view.part.partNo}</span>
            {view.part.drawingNo ? (
              <span className="text-dense text-ink-3">
                Drawing {view.part.drawingNo}
                {view.part.drawingRev ? ` rev ${view.part.drawingRev}` : ""}
              </span>
            ) : null}
            {view.part.materialText ? <span className="text-dense text-ink-3">· customer spec “{view.part.materialText}”</span> : null}
          </div>

          <Section title="Material and weights">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <Field label="Material" htmlFor="material" error={issueFor(issues, "material")?.message} aside={<ProvenanceCaption provenance={prov.material} current={material?.grade ?? null} />}>
                {editable ? (
                  <Select id="material" value={draft.materialItemId ?? ""} onChange={(e) => update({ materialItemId: e.target.value || null })} aria-invalid={Boolean(issueFor(issues, "material")) || undefined}>
                    <option value="" disabled>
                      Choose a grade
                    </option>
                    {groupedMaterials.map(([family, list]) => (
                      <optgroup key={family} label={familyLabel[family] ?? family}>
                        {list.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.grade ?? o.name} — {rateLabel(o)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                ) : (
                  <p className="py-1">{material ? `${material.name} · ${rateLabel(material)}` : "—"}</p>
                )}
              </Field>
              {(
                [
                  ["grossWeightKg", "Gross", "Input weight: cut bar or forging input"],
                  ["forgedWeightKg", "Forged", "Optional — forged parts only"],
                  ["netWeightKg", "Net", "Finished weight"],
                ] as const
              ).map(([key, label, hint]) => (
                <Field key={key} label={label} htmlFor={key} error={issueFor(issues, key)?.message} hint={!prov[key] ? hint : undefined} aside={<ProvenanceCaption provenance={prov[key]} current={draft[key]} />}>
                  {editable ? (
                    <NumberInput id={key} unit="kg" value={draft[key] ?? ""} onChange={(e) => update({ [key]: e.target.value || null, ...(key === "forgedWeightKg" && !e.target.value ? { scaleLossPct: null } : {}) })} aria-invalid={Boolean(issueFor(issues, key)) || undefined} placeholder={key === "forgedWeightKg" ? "—" : undefined} />
                  ) : (
                    <p className="num py-1 text-left">{draft[key] ? `${Number(draft[key])} kg` : "—"}</p>
                  )}
                </Field>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-dense text-ink-3">
              {forged ? (
                <label className="flex items-center gap-2">
                  Scale loss
                  {editable ? (
                    <NumberInput unit="%" value={draft.scaleLossPct ?? ""} onChange={(e) => update({ scaleLossPct: e.target.value || null })} className="w-24" aria-label="Scale loss %" />
                  ) : (
                    <span className="text-ink-2">{draft.scaleLossPct ? `${Number(draft.scaleLossPct)} %` : "—"}</span>
                  )}
                </label>
              ) : null}
              <span>
                Yield <span className="text-ink-2">{result.weights.yieldPct ? `${result.weights.yieldPct} %` : "—"}</span>
              </span>
              {result.weights.turningsKg ? (
                <span>
                  Turnings <span className="text-ink-2">{Number(result.weights.turningsKg)} kg</span>
                </span>
              ) : null}
              {result.weights.flashKg ? (
                <span>
                  Flash & end-bits <span className="text-ink-2">{Number(result.weights.flashKg)} kg</span>
                </span>
              ) : null}
              {issues.find((i) => i.code === "YIELD_LOW") ? <span className="text-warn">{issues.find((i) => i.code === "YIELD_LOW")!.message}</span> : null}
            </div>
          </Section>

          <Section
            title="Routing"
            description="Cycle time × hour rate for machines; per-kg or per-piece rates for processes. In-house work attracts overhead; job work does not."
            actions={
              unconfirmed > 0 && editable ? (
                <Button size="sm" onClick={() => update({ operations: draft.operations.map((o) => ({ ...o, confirmed: true })), routingConfirmed: true })}>
                  <Check /> Confirm routing ({unconfirmed})
                </Button>
              ) : null
            }
          >
            {draft.operations.length === 0 ? (
              <div className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center">
                <p className="text-sm font-medium">No routing yet</p>
                <p className="mt-1 text-dense text-ink-3">
                  {similar.suggestions.length ? "Start from a similar past part below, or add the first operation." : "Add the first operation."} The price stays withheld until the part has a routing.
                </p>
                {editable ? (
                  <Button
                    className="mt-3"
                    onClick={() =>
                      update({
                        operations: [{ id: newRowId(), name: "", itemId: null, kind: "MACHINE", cycleTimeMin: null, setupMin: "0", weightBasis: null, suggestedFromId: null, legacyName: null, confirmed: true }],
                      })
                    }
                  >
                    <Plus /> Add operation
                  </Button>
                ) : null}
                <RoutingSuggestions suggestions={similar.suggestions} href={similar.href} editable={editable} onUse={applyRouting} />
              </div>
            ) : (
              <RoutingTable
                operations={draft.operations}
                options={view.options}
                results={result.operations}
                issues={issues}
                editable={editable}
                hasForged={forged}
                suggestedFromLabel={(id) => (id ? (similar.labels[id] ?? null) : null)}
                setupPerBatch={result.setupPerBatch}
                onChange={(operations) => update({ operations, routingConfirmed: operations.every((o) => o.confirmed) })}
              />
            )}
            {weightGap !== null && Math.abs(weightGap) > 0.2 && unconfirmed > 0 ? (
              <p className="mt-3 text-xs text-warn">
                Cycle times were copied from {copiedFrom!.refNo}, a part {Math.round(Math.abs(weightGap) * 100)} % {weightGap > 0 ? "heavier" : "lighter"} than this one — check them before confirming.
              </p>
            ) : null}
            {uncovered.length && draft.operations.length ? (
              <p className="mt-3 text-xs text-warn">Drawing notes call for {uncovered.join(", ")} — not in the routing yet.</p>
            ) : view.part.processHints.length ? (
              <p className="mt-3 text-xs text-ink-3">Drawing notes mention: {view.part.processHints.join(", ")}.</p>
            ) : null}
          </Section>

          <Section title="Bought-out parts" description="Priced at cost from the BOP master; no overhead.">
            {draft.bop.length === 0 ? (
              <p className="text-dense text-ink-3">None.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {draft.bop.map((b, i) => {
                  const r = result.bop.find((x) => x.id === b.id);
                  return (
                    <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_96px_80px_32px] items-center gap-2">
                      {editable ? (
                        <Select value={b.itemId ?? ""} onChange={(e) => update({ bop: draft.bop.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)) })} aria-label="Bought-out item">
                          <option value="" disabled>
                            Choose…
                          </option>
                          {options("BOP").map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name} — {rateLabel(o)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span>{view.options.find((o) => o.id === b.itemId)?.name ?? "—"}</span>
                      )}
                      {editable ? (
                        <NumberInput unit="qty" value={b.quantity} onChange={(e) => update({ bop: draft.bop.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} aria-label="Quantity" />
                      ) : (
                        <span className="num">{Number(b.quantity)}</span>
                      )}
                      <span className="num text-right">{r?.costPerPiece ? formatNumber(r.costPerPiece, 2) : "—"}</span>
                      {editable ? (
                        <button type="button" onClick={() => update({ bop: draft.bop.filter((_, j) => j !== i) })} className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label="Remove bought-out part">
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {editable ? (
              <button type="button" onClick={() => update({ bop: [...draft.bop, { id: newRowId(), itemId: null, quantity: "1" }] })} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-dense text-accent hover:bg-accent-soft">
                <Plus className="size-4" /> Add bought-out part
              </button>
            ) : null}
          </Section>

          <Section title="Commercials">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Rejection allowance" htmlFor="rejection" error={issueFor(issues, "rejectionPct")?.message} hint="On material, BOP and conversion">
                {editable ? <NumberInput id="rejection" unit="%" value={draft.rejectionPct} onChange={(e) => update({ rejectionPct: e.target.value })} /> : <p className="py-1">{Number(draft.rejectionPct)} %</p>}
              </Field>
              <Field label="Batches per year" htmlFor="batches" hint="Setup is spread over each batch" error={issueFor(issues, "batchesPerYear")?.message}>
                {editable ? (
                  <NumberInput id="batches" value={String(draft.batchesPerYear)} onChange={(e) => update({ batchesPerYear: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} />
                ) : (
                  <p className="py-1">{draft.batchesPerYear}</p>
                )}
              </Field>
              <Field label="Packing" htmlFor="packing" hint={issues.some((i) => i.code === "PACKING_MISSING") ? "Not chosen — costed at ₹0" : undefined}>
                {editable ? (
                  <Select id="packing" value={draft.packingItemId ?? ""} onChange={(e) => update({ packingItemId: e.target.value || null })}>
                    <option value="">None</option>
                    {options("PACKING").map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {rateLabel(o)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="py-1">{view.options.find((o) => o.id === draft.packingItemId)?.name ?? "None"}</p>
                )}
              </Field>
              <Field label="Freight" htmlFor="freight" hint="Per kg of net weight to the customer's zone">
                {editable ? (
                  <Select id="freight" value={draft.freightItemId ?? ""} onChange={(e) => update({ freightItemId: e.target.value || null })}>
                    <option value="">None</option>
                    {options("FREIGHT").map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {rateLabel(o)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="py-1">{view.options.find((o) => o.id === draft.freightItemId)?.name ?? "None"}</p>
                )}
              </Field>
              <Field label="Tooling" htmlFor="tooling" error={issueFor(issues, "tooling.amortYears")?.message ?? issueFor(issues, "tooling.cost")?.message}>
                {editable ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                    <Select id="tooling" value={draft.toolingMode} onChange={(e) => update({ toolingMode: e.target.value as LineDraft["toolingMode"], toolingAmortYears: e.target.value === "AMORTIZED" ? (draft.toolingAmortYears ?? 3) : null })}>
                      <option value="NONE">No tooling</option>
                      <option value="SEPARATE">Charged separately</option>
                      <option value="AMORTIZED">Amortized in price</option>
                    </Select>
                    {draft.toolingMode !== "NONE" ? <NumberInput unit="₹" value={draft.toolingCost} onChange={(e) => update({ toolingCost: e.target.value })} aria-label="Tooling cost" /> : null}
                  </div>
                ) : (
                  <p className="py-1">{draft.toolingMode === "NONE" ? "None" : `${formatINR(draft.toolingCost)} · ${draft.toolingMode === "SEPARATE" ? "charged separately" : `amortized over ${draft.toolingAmortYears} yr`}`}</p>
                )}
              </Field>
              {draft.toolingMode === "AMORTIZED" && editable ? (
                <Field label="Amortize over" htmlFor="amort">
                  <NumberInput id="amort" unit="years" value={String(draft.toolingAmortYears ?? "")} onChange={(e) => update({ toolingAmortYears: Number(e.target.value.replace(/[^\d]/g, "")) || null })} />
                </Field>
              ) : null}
              <Field label="GST class" htmlFor="gst" hint="Shown separately on the quote; confirm the HSN with tax">
                {editable ? (
                  <Select id="gst" value={draft.gstClass} onChange={(e) => update({ gstClass: e.target.value as LineDraft["gstClass"] })}>
                    <option value="GST_18">Motor-vehicle parts (18 %)</option>
                    <option value="GST_5">Specified tractor parts (5 %)</option>
                  </Select>
                ) : (
                  <p className="py-1">{draft.gstClass === "GST_5" ? "5 %" : "18 %"}</p>
                )}
              </Field>
            </div>
            <dl className="mt-4 grid gap-x-4 gap-y-1 border-t border-line pt-3 text-dense sm:grid-cols-3">
              <div>
                <dt className="text-xs text-ink-3">Overhead (master)</dt>
                <dd title={view.params.overheadPct ? `${view.params.overheadPct.code} from ${view.params.overheadPct.effectiveFrom}` : undefined}>
                  {view.params.overheadPct ? `${Number(view.params.overheadPct.value)} % of in-house conversion` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">ICC (master)</dt>
                <dd>{view.params.iccRatePct && view.params.iccDays ? `${Number(view.params.iccRatePct.value)} % p.a. × ${Number(view.params.iccDays.value)} days` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Profit on (customer format)</dt>
                <dd>{view.quote.marginBasis === "CONVERSION" ? "In-house conversion only" : "Manufacturing cost"}</dd>
              </div>
            </dl>
          </Section>
        </div>

        {/* ── the price ── */}
        <aside className="flex flex-col gap-3 xl:sticky xl:top-4" aria-label="Cost breakup">
          <BreakupPanel
            tiers={draft.tiers}
            result={result}
            editable={editable}
            floorPct={view.params.marginFloorPct}
            onVolume={(i, volume) => update({ tiers: draft.tiers.map((t, j) => (j === i ? { ...t, volume } : t)) })}
            onMargin={(i, marginPct) => update({ tiers: draft.tiers.map((t, j) => (j === i ? { ...t, marginPct } : t)) })}
            onAddTier={addTier}
            onRemoveTier={(i) => update({ tiers: draft.tiers.filter((_, j) => j !== i) })}
            similar={similar.count ? { count: similar.count, href: similar.href, medianConversionPerKg: benchmark } : null}
          />

          <div className={cn("rounded-lg border bg-surface px-3 py-2.5 text-dense", errors.length ? "border-danger/30" : "border-line")}>
            {errors.length ? (
              <div>
                <p className="flex items-center gap-1.5 font-medium text-danger">
                  <AlertCircle className="size-4" aria-hidden /> Price withheld · {errors.length} {errors.length === 1 ? "error" : "errors"}
                </p>
                <ul className="mt-1 list-disc pl-5 text-ink-2">
                  {errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              </div>
            ) : base?.lines ? (
              <p>
                <span className="text-ink-3">At the RFQ volume ({formatInteger(base.volume)}):</span>{" "}
                <span className="num font-semibold">₹{formatNumber(base.lines.unitPrice, 2)}</span> per piece ·{" "}
                <span className="num">{formatINR(base.lines.annualValue)}</span> a year
              </p>
            ) : null}
            {warnings.length || submitIssues.length ? (
              <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-warn">
                {[...submitIssues, ...warnings].slice(0, 5).map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {w.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-dense">
            <SaveStatus state={save} />
            <div className="flex gap-1.5">
              {props.prev ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={props.prev.href} title={props.prev.label}>
                    <ArrowLeft /> Previous
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm">
                <Link href={props.next?.href ?? props.rfqHref}>
                  {props.next ? "Next part" : "Review & submit"} <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
          {save.kind === "conflict" ? (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload the latest version
            </Button>
          ) : null}
        </aside>
      </div>

      {/* Phone: the price stays in view */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-2 backdrop-blur xl:hidden">
        <div className="flex items-center justify-between gap-3 text-dense">
          {errors.length ? (
            <span className="font-medium text-danger">Price withheld · {errors.length} errors</span>
          ) : base?.lines ? (
            <span>
              <span className="num font-semibold">₹{formatNumber(base.lines.unitPrice, 2)}</span>
              <span className="text-ink-3"> / pc at {formatInteger(base.volume)}</span>
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          )}
          <SaveStatus state={save} />
        </div>
      </div>
    </div>
  );
}
