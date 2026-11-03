"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { RoutingSuggestion } from "@/server/services/past-quotes";

const OUTCOME_WORD: Record<RoutingSuggestion["outcome"], string> = { WON: "won", LOST: "lost", NO_RESPONSE: "no response", OPEN: "open", REGRETTED: "regretted" };

/** Routings of the closest past parts, offered where the routing is still empty (DESIGN.md §5.5). */
export function RoutingSuggestions(props: { suggestions: RoutingSuggestion[]; href: string; editable: boolean; onUse: (s: RoutingSuggestion) => void }) {
  if (props.suggestions.length === 0) return null;
  return (
    <div className="mt-5 border-t border-line pt-4 text-left">
      <p className="text-dense font-medium">Start from a similar past part</p>
      <p className="text-xs text-ink-3">Operations are copied as suggestions: check each cycle time, add setup times (the old register has none), then confirm the routing.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {props.suggestions.map((s) => (
          <li key={s.id} className="rounded-md border border-line bg-surface p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-dense">
                <span className="font-medium">{s.description}</span>
                <span className="text-ink-3">
                  {" "}
                  · {s.materialGrade ?? "—"}
                  {s.grossWeightKg ? ` · ${Number(s.grossWeightKg)} kg` : ""} · {s.customerName}
                </span>
              </p>
              <span className="text-xs text-ink-3">
                <span className="font-mono">{s.refNo}</span> · {OUTCOME_WORD[s.outcome]} {formatDate(s.quoteDate).slice(3)} · match {Math.round(s.score * 100)} %
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
              {s.ops.map((o, i) => (
                <span key={i}>
                  {i > 0 ? <span className="text-ink-4"> → </span> : null}
                  <span className={o.itemId ? undefined : "text-warn"}>{o.name.replace(/ \(job work\)$/, "")}</span>
                  {o.cycleTimeMin ? <span className="text-ink-3"> {Number(o.cycleTimeMin)} min</span> : null}
                </span>
              ))}
            </p>
            {props.editable ? (
              <Button size="sm" className="mt-2.5" onClick={() => props.onUse(s)}>
                Use this routing
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Link href={props.href} className="mt-2.5 inline-block text-xs text-accent hover:underline">
        All similar past parts and their prices
      </Link>
    </div>
  );
}
