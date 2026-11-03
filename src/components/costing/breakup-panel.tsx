"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { breakupRows } from "@/domain/costing/labels";
import type { CostingResult } from "@/domain/costing/types";
import type { TierDraft } from "@/domain/costing/draft";
import { cn } from "@/lib/cn";
import { formatINRCompact, formatInteger, formatNumber } from "@/lib/format";

const money = (v: string | null | undefined) => (v === null || v === undefined ? "—" : formatNumber(v, 2).replace("-", "−"));

/**
 * The cost build-up, one aligned column per volume. Volumes are edited in the column headers and
 * margins in the margin row, so every change shows its price directly below it. Columns use a
 * fixed layout so live recalculation never shifts them.
 */
export function BreakupPanel(props: {
  tiers: TierDraft[];
  result: CostingResult;
  editable: boolean;
  floorPct: string | null;
  onVolume: (index: number, value: number) => void;
  onMargin: (index: number, value: string) => void;
  onAddTier: () => void;
  onRemoveTier: (index: number) => void;
  /** Similar past parts: how many, and the median conversion ₹/kg of those with weights. */
  similar?: { count: number; href: string; medianConversionPerKg: string | null } | null;
}) {
  const { tiers, result, editable } = props;
  const rows = breakupRows(result);
  const cols = tiers.length || 1;
  const tierIssue = (i: number) => result.issues.find((x) => x.tierIndex === i && x.severity === "error");
  const base = tiers.findIndex((t) => t.isBase);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full table-fixed border-collapse text-dense">
        <colgroup>
          <col className="w-[33%]" />
          {Array.from({ length: cols }, (_, i) => (
            <col key={i} />
          ))}
          {editable && tiers.length < 3 ? <col className="w-9" /> : null}
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-ink-3">
              ₹ per piece
              <span className="block font-normal">at volume / year</span>
            </th>
            {tiers.map((t, i) => (
              <th key={i} scope="col" className={cn("px-2 py-1.5 text-right align-top", t.isBase && "bg-accent-soft")}>
                {t.isBase || !editable ? (
                  <span className="num block py-1 text-xs font-medium sm:text-dense">{formatInteger(t.volume)}</span>
                ) : (
                  <span className="group relative block">
                    <input
                      aria-label={`Volume ${i + 1}`}
                      inputMode="numeric"
                      value={t.volume ? formatInteger(t.volume) : ""}
                      placeholder="Volume"
                      onChange={(e) => props.onVolume(i, Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
                      className="num h-7 w-full rounded border-b border-dashed border-control bg-transparent px-0.5 text-right text-xs font-medium outline-none sm:text-dense focus:border-solid focus:border-accent focus:ring-2 focus:ring-accent/15"
                    />
                    <button
                      type="button"
                      onClick={() => props.onRemoveTier(i)}
                      className="absolute -top-1 -left-1 hidden size-5 items-center justify-center rounded-full bg-surface text-ink-3 shadow-sm ring-1 ring-line group-hover:flex focus:flex"
                      aria-label={`Remove volume ${i + 1}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                <span className="block text-xs font-normal text-ink-3">{t.isBase ? "RFQ volume" : tierIssue(i) ? <span className="text-danger">check</span> : " "}</span>
              </th>
            ))}
            {editable && tiers.length < 3 ? (
              <th scope="col" className="px-1">
                <button type="button" onClick={props.onAddTier} className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink" aria-label="Add a volume" title="Add a volume">
                  <Plus className="size-4" />
                </button>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={cn(row.emphasis === "subtotal" && "border-t border-line font-semibold", row.emphasis === "total" && "border-t-2 border-ink/80 bg-accent-soft/50")}>
              <th scope="row" className={cn("px-3 py-[3px] text-left leading-tight font-normal text-ink-2", row.emphasis && "font-semibold text-ink", row.emphasis === "total" && "py-2 text-sm")}>
                {row.label}
              </th>
              {row.values.map((v, i) => (
                <td key={i} className={cn("num px-2 py-[3px] text-right", v === null && "text-ink-4", tiers[i]?.isBase && "bg-accent-soft/60", row.emphasis === "total" && "py-2 text-base font-semibold")}>
                  {money(v)}
                </td>
              ))}
              {editable && tiers.length < 3 ? <td /> : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <th scope="row" className="px-3 pt-2 pb-1 text-left text-xs font-medium text-ink-3">
              Margin %
            </th>
            {tiers.map((t, i) => {
              const below = props.floorPct !== null && Number(t.marginPct) < Number(props.floorPct);
              return (
                <td key={i} className={cn("px-2 pt-1.5 pb-1 text-right", t.isBase && "bg-accent-soft/60")}>
                  {editable ? (
                    <input
                      aria-label={`Margin for volume ${i + 1}`}
                      inputMode="decimal"
                      value={t.marginPct}
                      onChange={(e) => props.onMargin(i, e.target.value)}
                      className={cn(
                        "num h-7 w-full rounded border border-control bg-surface px-1.5 text-right outline-none focus:border-accent focus:ring-2 focus:ring-accent/15",
                        below && "border-warn",
                      )}
                    />
                  ) : (
                    <span className="num">{Number(t.marginPct)}</span>
                  )}
                  {below ? <span className="block text-[11px] text-warn">below {Number(props.floorPct)} %</span> : null}
                </td>
              );
            })}
            {editable && tiers.length < 3 ? <td /> : null}
          </tr>
          {(
            [
              ["pricePerKg", "₹ per kg (net)"],
              ["conversionPerKg", "Conversion ₹ per kg"],
              ["annualValue", "Annual value"],
            ] as const
          ).map(([key, label]) => (
            <tr key={key}>
              <th scope="row" className="px-3 py-[3px] text-left text-xs font-normal text-ink-3">
                {label}
              </th>
              {result.tiers.map((t, i) => (
                <td key={i} className={cn("num px-2 py-[3px] text-right text-xs text-ink-2", tiers[i]?.isBase && "bg-accent-soft/60")}>
                  {t.lines ? (key === "annualValue" ? formatINRCompact(t.lines.annualValue) : money(t.lines[key])) : "—"}
                </td>
              ))}
              {editable && tiers.length < 3 ? <td /> : null}
            </tr>
          ))}
          <tr>
            <td colSpan={cols + 2} className="h-2" />
          </tr>
        </tfoot>
      </table>
      {base < 0 && tiers.length ? <p className="border-t border-line px-3 py-2 text-xs text-danger">One volume must be the RFQ volume.</p> : null}
      {props.similar ? <SimilarLine similar={props.similar} conversion={base >= 0 ? (result.tiers[base]?.lines?.conversionPerKg ?? null) : null} /> : null}
    </div>
  );
}

function SimilarLine({ similar, conversion }: { similar: { count: number; href: string; medianConversionPerKg: string | null }; conversion: string | null }) {
  const median = similar.medianConversionPerKg ? Number(similar.medianConversionPerKg) : null;
  const gap = median && conversion ? Math.round(((Number(conversion) - median) / median) * 100) : null;
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-xs text-ink-3">
      <span>
        {median !== null ? (
          <>
            Similar past parts: conversion median <span className="num text-ink-2">₹{formatNumber(median, 2)}/kg</span>
            {gap !== null ? (
              <span className={cn(Math.abs(gap) > 25 ? "text-warn" : "text-ink-2")}>
                {" "}
                · this part {gap >= 0 ? "+" : "−"}
                {Math.abs(gap)} %
              </span>
            ) : null}
          </>
        ) : (
          `${similar.count} similar past part${similar.count === 1 ? "" : "s"}`
        )}
      </span>
      <Link href={similar.href} className="text-accent hover:underline">
        See {similar.count} similar
      </Link>
    </p>
  );
}
