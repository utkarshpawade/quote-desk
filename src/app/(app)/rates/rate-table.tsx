"use client";

import { SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input, NumberInput } from "@/components/ui/input";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { RateRow } from "@/server/services/rate-admin";
import { addRateVersionAction, voidRateVersionAction } from "./actions";

const UNIT: Record<string, string> = { PER_KG: "₹/kg", PER_HOUR: "₹/h", PER_PIECE: "₹/pc", PERCENT: "%", RUPEES: "₹", COUNT: "", DAYS: "days" };

function show(value: string, unit: string) {
  const n = Number(value);
  if (unit === "PERCENT" || unit === "COUNT" || unit === "DAYS") return `${n}${unit === "PERCENT" ? " %" : unit === "DAYS" ? " days" : ""}`;
  return formatNumber(value, unit === "RUPEES" ? 0 : 2);
}

export function RateTable({ rows, asOf, today, canManage }: { rows: RateRow[]; asOf: string; today: string; canManage: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState icon={SlidersHorizontal} title="No rates in this category" />
      </div>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-line bg-surface">
        <TableScroll>
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th numeric>{asOf === today ? "Current" : `On ${formatDate(asOf)}`}</Th>
                <Th>Unit</Th>
                <Th>Since</Th>
                <Th>Next change</Th>
                <Th numeric>Quotes using</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => setOpenId(r.id)}>
                  <Td className="font-mono text-xs">
                    <button type="button" className="text-accent hover:underline underline-offset-2" onClick={() => setOpenId(r.id)}>
                      {r.code}
                    </button>
                  </Td>
                  <Td>
                    {r.name}
                    {Array.isArray(r.attributes.aliases) && r.attributes.aliases.length ? (
                      <span className="block truncate text-xs text-ink-3">also: {(r.attributes.aliases as string[]).join(", ")}</span>
                    ) : null}
                  </Td>
                  <Td numeric className="font-medium">
                    {r.current ? show(r.current.value, r.unit) : <span className="text-danger">none</span>}
                  </Td>
                  <Td className="text-ink-3">{UNIT[r.unit]}</Td>
                  <Td className="text-ink-3">{r.current ? formatDate(r.current.effectiveFrom) : "—"}</Td>
                  <Td>{r.next ? <Chip tone="neutral">{`${show(r.next.value, r.unit)} from ${formatDate(r.next.effectiveFrom)}`}</Chip> : <span className="text-ink-4">—</span>}</Td>
                  <Td numeric className="text-ink-2">
                    {r.quotes || <span className="text-ink-4">0</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </section>
      {open ? <RateDrawer row={open} today={today} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function RateDrawer({ row, today, canManage, onClose }: { row: RateRow; today: string; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  function add(confirmLargeChange: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await addRateVersionAction({ itemId: row.id, value, effectiveFrom: from, note: note || null, confirmLargeChange });
      if (!res.ok) return setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] ?? res.error : res.error);
      if (res.data.largeChange) return setConfirm(true);
      toast.success(`${row.code}: ${value} from ${formatDate(from)} saved.`);
      setValue("");
      setNote("");
      setConfirm(false);
      router.refresh();
    });
  }

  function voidVersion(versionId: string) {
    setError(null);
    startTransition(async () => {
      const res = await voidRateVersionAction({ versionId, reason: voidReason });
      if (!res.ok) return setError(res.error);
      toast.success(res.data.draftsAffected ? `Voided. ${res.data.draftsAffected} draft quote(s) will pick up the live rate when re-priced.` : "Voided.");
      setVoiding(null);
      setVoidReason("");
      router.refresh();
    });
  }

  const latest = row.versions.find((v) => v.voidedAt === null && v.effectiveFrom <= from);
  const change = latest && value && Number(latest.value) ? ((Number(value) - Number(latest.value)) / Number(latest.value)) * 100 : null;

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`${row.code} · ${row.name}`} description={`${UNIT[row.unit] || "value"} · ${row.versions.length} version(s)`} width="lg">
      <div className="flex flex-col gap-6">
        {canManage ? (
          <section aria-labelledby="add-h" className="rounded-md border border-line p-4">
            <h3 id="add-h" className="mb-3 text-sm font-semibold">
              Add a version
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New value" htmlFor="rate-value" hint={change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(1)} % against ${Number(latest!.value)}` : undefined}>
                <NumberInput id="rate-value" unit={UNIT[row.unit]} value={value} onChange={(e) => (setValue(e.target.value), setConfirm(false))} />
              </Field>
              <Field label="Effective from" htmlFor="rate-from" hint={from < today ? "Back-dated: allowed only if no submitted quote would change." : undefined}>
                <Input id="rate-from" type="date" value={from} onChange={(e) => (setFrom(e.target.value), setConfirm(false))} />
              </Field>
              <Field label={from < today ? "Why (required for a past date)" : "Note"} htmlFor="rate-note" className="sm:col-span-2">
                <Input id="rate-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mill circular 11/2026, ERP export, …" />
              </Field>
            </div>
            {confirm ? (
              <Notice tone="warn" className="mt-3" title="That is a change of more than 20 %" action={<Button size="sm" variant="primary" onClick={() => add(true)} loading={pending}>Save anyway</Button>}>
                Check for a typo (72.50 vs 725.00) before saving.
              </Notice>
            ) : null}
            {error ? <p className="mt-3 text-dense text-danger">{error}</p> : null}
            <div className="mt-3 flex justify-end">
              <Button variant="primary" onClick={() => add(false)} loading={pending} disabled={!value || !from}>
                Save version
              </Button>
            </div>
          </section>
        ) : (
          <p className="text-dense text-ink-3">Rate masters are maintained by the sales head.</p>
        )}

        <section aria-labelledby="hist-h">
          <h3 id="hist-h" className="mb-2 text-sm font-semibold">
            History
          </h3>
          <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
            {row.versions.map((v) => (
              <li key={v.id} className={cn("px-4 py-3 text-dense", v.voidedAt && "bg-subtle/60")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={cn("num text-base font-semibold", v.voidedAt && "text-ink-3 line-through")}>{show(v.value, row.unit)}</span>
                  <span className="text-ink-2">
                    {formatDate(v.effectiveFrom)} → {v.effectiveTo ? formatDate(v.effectiveTo) : v.voidedAt ? "void" : "open"}
                    {v.effectiveFrom > today && !v.voidedAt ? <Chip className="ml-2">scheduled</Chip> : null}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">
                  {v.createdByName} · {formatDateTime(v.createdAt)}
                  {v.note ? ` · ${v.note}` : ""}
                </p>
                <p className="text-xs text-ink-3">
                  {v.quotes ? `Used by ${v.quotes} quote${v.quotes > 1 ? "s" : ""}${v.frozen ? ` (${v.frozen} submitted or sent)` : ""}` : "Not used by any quote"}
                </p>
                {v.voidedAt ? <p className="text-xs text-warn">Void — {v.voidReason}</p> : null}
                {canManage && !v.voidedAt && v.frozen === 0 ? (
                  voiding === v.id ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why is it void? (e.g. typo: 725 for 72.50)" className="min-w-56 flex-1" aria-label="Void reason" />
                      <Button size="sm" variant="danger" onClick={() => voidVersion(v.id)} loading={pending}>
                        Void
                      </Button>
                      <Button size="sm" onClick={() => setVoiding(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="link" className="mt-1" onClick={() => (setVoiding(v.id), setVoidReason(""))}>
                      Void this version
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-3">Versions used by a submitted or sent quote can never be voided — those quotes keep the rates they were priced with.</p>
        </section>
      </div>
    </Drawer>
  );
}
