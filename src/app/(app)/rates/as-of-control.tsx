"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

/** Look at the master as it stood on any date — the same lookup a quote's basis date does. */
export function AsOfControl({ asOf, today, category }: { asOf: string; today: string; category: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-dense text-ink-3">
      Rates as of
      <Input
        type="date"
        value={asOf}
        onChange={(e) => {
          const value = e.target.value;
          router.replace(`/rates?category=${category}${value && value !== today ? `&asOf=${value}` : ""}`, { scroll: false });
        }}
        className="w-40"
      />
    </label>
  );
}
