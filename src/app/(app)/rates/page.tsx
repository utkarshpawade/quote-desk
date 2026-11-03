import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { todayIst } from "@/domain/calendar";
import { can } from "@/domain/permissions";
import type { RateCategory } from "@/domain/rates/catalog";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listRateMaster } from "@/server/services/rate-admin";
import { AsOfControl } from "./as-of-control";
import { RateTable } from "./rate-table";

export const metadata: Metadata = { title: "Rate masters" };

const TABS: Array<{ key: RateCategory; label: string; blurb: string }> = [
  { key: "MATERIAL", label: "Materials", blurb: "Bar and forging steel, ₹ per kg delivered Chakan." },
  { key: "SCRAP", label: "Scrap", blurb: "What turnings and forging flash sell for, ₹ per kg." },
  { key: "MACHINE", label: "Machines", blurb: "Machine-hour rates including labour and power, ₹ per hour." },
  { key: "PROCESS", label: "Processes", blurb: "Forging, heat treatment and finishing, ₹ per kg or per piece. Job work attracts no overhead." },
  { key: "BOP", label: "Bought-out", blurb: "Bought-out parts fitted to our parts, ₹ per piece." },
  { key: "PACKING", label: "Packing", blurb: "Packing per piece." },
  { key: "FREIGHT", label: "Freight", blurb: "Freight per kg of finished weight, by customer zone." },
  { key: "COMMERCIAL", label: "Commercial", blurb: "Overhead, ICC, margins, the approval threshold and GST — versioned like any rate." },
];

export default async function RatesPage({ searchParams }: { searchParams: Promise<{ category?: string; asOf?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayIst();
  const category = (TABS.find((t) => t.key === params.category)?.key ?? "MATERIAL") as RateCategory;
  const asOf = params.asOf && /^\d{4}-\d{2}-\d{2}$/.test(params.asOf) ? params.asOf : today;
  const rows = await listRateMaster(db, category, asOf);
  const tab = TABS.find((t) => t.key === category)!;

  return (
    <Page>
      <PageHeader
        title="Rate masters"
        meta="One master for every rate. Each change is a new dated version, so a quote always keeps the rates it was priced with."
        actions={<AsOfControl asOf={asOf} today={today} category={category} />}
      />
      <nav aria-label="Rate categories" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`/rates?category=${t.key}${asOf !== today ? `&asOf=${asOf}` : ""}`}
                aria-current={t.key === category ? "page" : undefined}
                className={`-mb-px flex h-9 items-center border-b-2 px-3 text-sm whitespace-nowrap ${t.key === category ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mb-3 text-dense text-ink-3">
        {tab.blurb} {asOf !== today ? <span className="font-medium text-warn">Showing the master as it stood on {formatDate(asOf)}.</span> : null}
      </p>
      <RateTable rows={rows} asOf={asOf} today={today} canManage={can(user.role, "rates.manage")} />
    </Page>
  );
}
