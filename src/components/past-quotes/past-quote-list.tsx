"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusDot } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { COMPONENT_LABEL, WEIGHTS, type Component, type Match } from "@/domain/similarity/score";
import { cn } from "@/lib/cn";
import { formatDate, formatInteger, formatNumber } from "@/lib/format";
import type { Outcome, PastQuoteRow } from "@/server/services/past-quotes";

export const OUTCOME: Record<Outcome, { label: string; color: string }> = {
  WON: { label: "Won", color: "var(--color-st-won)" },
  LOST: { label: "Lost", color: "var(--color-st-lost)" },
  NO_RESPONSE: { label: "No response", color: "var(--color-st-muted)" },
  OPEN: { label: "Open", color: "var(--color-st-sent)" },
  REGRETTED: { label: "Regretted", color: "var(--color-st-muted)" },
};

type Row = PastQuoteRow & { match?: Match };

const kg = (v: string | null) => (v ? `${Number(v)} kg` : null);
const rs = (v: string) => `₹${formatNumber(v, 2)}`;
const signed = (v: string) => `${Number(v) >= 0 ? "+" : "−"}₹${formatNumber(Math.abs(Number(v)), 2)}`;

function Weights({ row }: { row: Row }) {
  const parts = [kg(row.grossWeightKg), kg(row.netWeightKg)].filter(Boolean);
  return parts.length ? <>{parts.join(" → ")}</> : <span className="text-ink-4">—</span>;
}

function Adjusted({ row, compact = false }: { row: Row; compact?: boolean }) {
  if (!row.rmAdjusted) return <span className="text-ink-4">—</span>;
  const d = Number(row.rmAdjusted.delta);
  return (
    <span className="inline-flex flex-col items-end">
      <span>{rs(row.rmAdjusted.value)}</span>
      {!compact ? <span className={cn("text-xs", d === 0 ? "text-ink-4" : "text-ink-3")}>{d === 0 ? "no change" : signed(row.rmAdjusted.delta)}</span> : null}
    </span>
  );
}

/** Past quotes as a table (cards on phones); a row opens its routing and price history. */
export function PastQuoteList({ rows, showMatch = false }: { rows: Row[]; showMatch?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      <TableScroll className="hidden md:block">
        <Table>
          <thead>
            <tr>
              {showMatch ? <Th numeric>Match</Th> : null}
              <Th>Quote</Th>
              <Th>Customer</Th>
              <Th>Part</Th>
              <Th>Material · weight</Th>
              <Th numeric>Annual qty</Th>
              <Th numeric>Quoted ₹/pc</Th>
              <Th numeric title="The quoted price with today's steel and scrap rates">At today’s steel</Th>
              <Th numeric>₹/kg</Th>
              <Th>Outcome</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className="group cursor-pointer hover:bg-subtle/60" onClick={() => setOpenId(r.id)}>
                {showMatch && r.match ? (
                  <Td numeric className="font-medium">
                    {Math.round(r.match.score * 100)} %
                  </Td>
                ) : null}
                <Td className="h-12 whitespace-nowrap">
                  <button type="button" onClick={() => setOpenId(r.id)} className="font-mono text-dense text-accent group-hover:underline underline-offset-2">
                    {r.refNo}
                  </button>
                  <div className="text-xs text-ink-3">{formatDate(r.quoteDate)}</div>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{r.customerName}</Td>
                <Td className="max-w-[16rem]">
                  <div className="truncate">{r.description}</div>
                  {r.partNo ? <div className="truncate font-mono text-xs text-ink-3">{r.partNo}</div> : null}
                </Td>
                <Td className="whitespace-nowrap">
                  <div>{r.materialGrade ?? r.materialText ?? "—"}</div>
                  <div className="text-xs text-ink-3">
                    <Weights row={r} />
                  </div>
                </Td>
                <Td numeric className="text-ink-2">
                  {r.annualVolume ? formatInteger(r.annualVolume) : <span className="text-ink-4">—</span>}
                </Td>
                <Td numeric className="font-medium">
                  {rs(r.unitPrice)}
                </Td>
                <Td numeric className="text-ink-2">
                  <Adjusted row={r} />
                </Td>
                <Td numeric className="text-ink-2">
                  {r.pricePerKg ? formatNumber(r.pricePerKg, 2) : <span className="text-ink-4">—</span>}
                </Td>
                <Td>
                  <StatusDot color={OUTCOME[r.outcome].color} label={OUTCOME[r.outcome].label} />
                  {r.lostReason ? <div className="text-xs text-ink-3">{r.lostReason}</div> : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpenId(r.id)} className="block w-full px-4 py-3 text-left active:bg-subtle">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{r.description}</span>
                <span className="num font-medium">{rs(r.unitPrice)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-ink-3">
                <span className="truncate">
                  {r.customerName} · {r.materialGrade ?? r.materialText ?? "—"} · <Weights row={r} />
                </span>
                {r.rmAdjusted ? <span className="num shrink-0">today {rs(r.rmAdjusted.value)}</span> : null}
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-ink-3">
                  {r.refNo} · {formatDate(r.quoteDate)}
                </span>
                <span className="flex items-center gap-2">
                  {showMatch && r.match ? <span className="font-medium">{Math.round(r.match.score * 100)} % match</span> : null}
                  <StatusDot color={OUTCOME[r.outcome].color} label={OUTCOME[r.outcome].label} className="text-xs" />
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <Drawer
        open={open !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        width="lg"
        title={open ? `${open.refNo} · ${open.description}` : ""}
        description={open ? `${open.customerName} · ${formatDate(open.quoteDate)} · ${OUTCOME[open.outcome].label}${open.lostReason ? ` (${open.lostReason.toLowerCase()})` : ""}` : undefined}
      >
        {open ? <PastQuoteDetail row={open} /> : null}
      </Drawer>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function PastQuoteDetail({ row }: { row: Row }) {
  const scrapKg = row.grossWeightKg && row.netWeightKg ? (Number(row.grossWeightKg) - Number(row.netWeightKg)).toFixed(3) : null;
  return (
    <div className="flex flex-col gap-6 text-dense">
      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Price</h3>
        <dl>
          <Fact label="Quoted unit price">
            <span className="font-medium">{rs(row.unitPrice)}</span>
          </Fact>
          <Fact label="Per kg of finished weight">{row.pricePerKg ? rs(row.pricePerKg) : "—"}</Fact>
          <Fact label="Conversion per kg (price less steel net of scrap)">{row.conversionPerKg ? rs(row.conversionPerKg) : "—"}</Fact>
          <Fact label="At today’s steel and scrap rates">
            {row.rmAdjusted ? (
              <span className="font-medium">
                {rs(row.rmAdjusted.value)} <span className="font-normal text-ink-3">({signed(row.rmAdjusted.delta)})</span>
              </span>
            ) : (
              <span className="text-ink-3">not available</span>
            )}
          </Fact>
        </dl>
        {row.rm && row.rmAdjusted ? (
          <p className="mt-2 rounded-md bg-subtle px-3 py-2 text-xs leading-relaxed text-ink-2">
            {row.materialGrade} was ₹{formatNumber(row.rm.then.rmRate, 2)}/kg on {formatDate(row.quoteDate)} and is ₹{formatNumber(row.rm.now.rmRate, 2)}/kg today, on{" "}
            {Number(row.grossWeightKg)} kg gross
            {scrapKg && !row.rmAdjusted.estimated ? (
              <>
                ; turnings went from ₹{formatNumber(row.rm.then.scrapRate, 2)} to ₹{formatNumber(row.rm.now.scrapRate, 2)}/kg on {Number(scrapKg)} kg of scrap
              </>
            ) : null}
            . Machining and process rates are not adjusted.
            {row.rmAdjusted.estimated ? " Estimated: the net weight is unknown, so scrap is not adjusted." : ""}
          </p>
        ) : (
          <p className="mt-2 text-xs text-ink-3">
            {!row.materialGrade
              ? `No adjustment: “${row.materialText ?? "the material"}” is not in the rate master.`
              : !row.grossWeightKg
                ? "No adjustment: the gross weight was not recorded."
                : "No adjustment: no steel rate on record for the quote date."}
          </p>
        )}
      </section>

      {row.match ? (
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Why it matched · {Math.round(row.match.score * 100)} %</h3>
          <ul className="flex flex-col gap-1.5">
            {(Object.keys(WEIGHTS) as Component[]).map((key) => {
              const v = row.match!.components[key];
              return (
                <li key={key} className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3">
                  <span className="text-ink-3">{COMPONENT_LABEL[key]}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
                    {v !== null ? <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} /> : null}
                  </span>
                  <span className="num text-xs text-ink-2">{v === null ? "not known" : `${Math.round(v * 100)} %`}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Weights: name 35 %, shape 20 %, material 15 %, weight 15 %, processes 10 %, recency 5 %. Unknown items are left out.</p>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Part</h3>
        <dl>
          <Fact label="Part no.">{row.partNo ? <span className="font-mono">{row.partNo}</span> : "—"}</Fact>
          <Fact label="Material">
            {row.materialGrade ?? "—"}
            {row.materialText && row.materialText !== row.materialGrade ? <span className="text-ink-3"> (written “{row.materialText}”)</span> : null}
          </Fact>
          <Fact label="Gross → net">
            <Weights row={row} />
          </Fact>
          <Fact label="Made from">{row.inputForm === "FORGING" ? "Forging" : row.inputForm === "BAR" ? "Bar" : "—"}</Fact>
          <Fact label="Annual qty">{row.annualVolume ? formatInteger(row.annualVolume) : "—"}</Fact>
          <Fact label="Estimator">{row.estimatorName ?? "—"}</Fact>
          <Fact label="Source">
            {row.source === "APP" && row.rfqId ? (
              <Link href={`/rfqs/${row.rfqId}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                Sent from Quote Desk <ExternalLink className="size-3" />
              </Link>
            ) : (
              "Old quote register (imported)"
            )}
          </Fact>
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Routing</h3>
        {row.routingOps.length === 0 ? (
          <p className="text-ink-3">No routing was recorded for this quote.</p>
        ) : (
          <ol className="flex flex-col">
            {row.routingOps.map((op, i) => (
              <li key={i} className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-2 border-b border-line py-1.5 last:border-b-0">
                <span className="text-ink-3">{(i + 1) * 10}</span>
                <span className="min-w-0">
                  <span className={cn(!op.itemId && "text-warn")}>{op.name}</span>
                  {op.legacyName && op.legacyName !== op.name ? <span className="block text-xs text-ink-3">written “{op.legacyName}”</span> : null}
                  {!op.itemId ? <span className="block text-xs text-warn">No matching work centre today</span> : null}
                </span>
                <span className="num text-ink-2">{op.cycleTimeMin ? `${Number(op.cycleTimeMin)} min` : ""}</span>
              </li>
            ))}
          </ol>
        )}
        {row.routingText && row.source === "LEGACY_IMPORT" ? <p className="mt-2 font-mono text-xs text-ink-3">As written: {row.routingText}</p> : null}
      </section>
    </div>
  );
}
