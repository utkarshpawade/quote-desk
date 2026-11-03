"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";

type Chip = "overdue" | "due-soon" | "returned";

const CHIP_LABEL: Record<Chip, string> = {
  overdue: "Overdue",
  "due-soon": "Due ≤ 2 wd",
  returned: "Returned",
};

/** Search, quick filters and owner/customer filters; everything lives in the URL. */
export function RegisterToolbar(props: {
  view: string;
  chip?: Chip;
  chips: Record<Chip, number>;
  q: string;
  owner: string;
  customer: string;
  estimators: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(props.q);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    next.set("view", props.view);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Debounced search.
  useEffect(() => {
    if (q === props.q) return;
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="RFQ, customer, part no or name"
          aria-label="Search RFQs"
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
        {(Object.keys(CHIP_LABEL) as Chip[]).map((key) => {
          const active = props.chip === key;
          const count = props.chips[key];
          if (!active && count === 0) return null;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => update({ chip: active ? null : key })}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-dense transition-colors",
                active ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-ink-2 hover:bg-hover",
              )}
            >
              {CHIP_LABEL[key]}
              <span className={cn("num text-xs", key === "overdue" && !active ? "font-medium text-danger" : "")}>{count}</span>
              {active ? <X className="size-3" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex w-full gap-2 sm:w-auto">
        <Select aria-label="Owner" value={props.owner} onChange={(e) => update({ owner: e.target.value || null })} className="sm:w-44">
          <option value="">All owners</option>
          {props.estimators.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Customer" value={props.customer} onChange={(e) => update({ customer: e.target.value || null })} className="sm:w-40">
          <option value="">All customers</option>
          {props.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {pending ? <Spinner className="self-center text-ink-3" label="Updating" /> : null}
      </div>
    </div>
  );
}
