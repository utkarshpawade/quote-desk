"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/** Search and filters for past quotes; everything lives in the URL. */
export function PastQuotesToolbar(props: {
  q: string;
  customer: string;
  outcome: string;
  material: string;
  customers: string[];
  materials: Array<{ id: string; grade: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(props.q);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (q === props.q) return;
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-80">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part name, part no, material, customer" aria-label="Search past quotes" className="pl-8" />
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
        <Select aria-label="Customer" value={props.customer} onChange={(e) => update({ customer: e.target.value || null })} className="sm:w-40">
          <option value="">All customers</option>
          {props.customers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select aria-label="Material" value={props.material} onChange={(e) => update({ material: e.target.value || null })} className="sm:w-36">
          <option value="">All materials</option>
          {props.materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.grade}
            </option>
          ))}
        </Select>
        <Select aria-label="Outcome" value={props.outcome} onChange={(e) => update({ outcome: e.target.value || null })} className="col-span-2 sm:w-36">
          <option value="">Any outcome</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
          <option value="NO_RESPONSE">No response</option>
          <option value="REGRETTED">Regretted</option>
          <option value="OPEN">Open</option>
        </Select>
      </div>
      {pending ? <Spinner className="text-ink-3" label="Updating" /> : null}
    </div>
  );
}
