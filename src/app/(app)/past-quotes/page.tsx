import { ArrowLeft, FileSpreadsheet, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PastQuoteList } from "@/components/past-quotes/past-quote-list";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/states";
import { THRESHOLD } from "@/domain/similarity/score";
import { formatInteger, formatNumber } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { findSimilarForPart, PAGE_SIZE, pastQuoteFilterOptions, searchPastQuotes } from "@/server/services/past-quotes";
import { PastQuotesToolbar } from "./past-quotes-toolbar";

export const metadata: Metadata = { title: "Past quotes" };

type Params = Record<string, string | undefined>;

export default async function PastQuotesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const params = await searchParams;
  return params.similar ? <SimilarParts partId={params.similar} /> : <Search params={params} />;
}

async function Search({ params }: { params: Params }) {
  const page = Number(params.page) || 1;
  const [options, result] = await Promise.all([
    pastQuoteFilterOptions(db),
    searchPastQuotes(db, { q: params.q, customer: params.customer, outcome: params.outcome, material: params.material, page }),
  ]);
  const filtered = Boolean(params.q || params.customer || params.outcome || params.material);
  const query = (p: number) => {
    const next = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
    next.set("page", String(p));
    return `/past-quotes?${next.toString()}`;
  };
  const from = (result.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(result.total, result.page * PAGE_SIZE);

  return (
    <Page>
      <PageHeader
        title="Past quotes"
        meta={
          options.total ? (
            <span>
              {formatInteger(options.total)} quoted parts from the old register and Quote Desk · {Math.round((options.won / options.total) * 100)} % won. “At today’s steel” re-prices the
              material at current rates.
            </span>
          ) : (
            "What was quoted before, for parts like the one on your desk."
          )
        }
        actions={
          <Button asChild>
            <Link href="/imports">
              <FileSpreadsheet /> Import register
            </Link>
          </Button>
        }
      />
      {options.total ? (
        <PastQuotesToolbar
          q={params.q ?? ""}
          customer={params.customer ?? ""}
          outcome={params.outcome ?? ""}
          material={params.material ?? ""}
          customers={options.customers}
          materials={options.materials}
        />
      ) : null}

      <section className="mt-3 rounded-lg border border-line bg-surface">
        {result.rows.length === 0 ? (
          options.total === 0 ? (
            <EmptyState
              icon={History}
              title="No past quotes yet"
              description="Import the old Excel quote register; quotes sent from Quote Desk are added automatically."
              action={
                <Button asChild variant="primary">
                  <Link href="/imports">Import the register</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={History}
              title="No past quotes match"
              description={filtered ? "Try fewer words, or clear a filter." : undefined}
              action={
                <Button asChild>
                  <Link href="/past-quotes">Clear filters</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <PastQuoteList rows={result.rows} />
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-dense text-ink-3">
              <span>
                {formatInteger(from)}–{formatInteger(to)} of {formatInteger(result.total)}
              </span>
              <span className="flex gap-2">
                {result.page > 1 ? (
                  <Button asChild size="sm">
                    <Link href={query(result.page - 1)}>Previous</Link>
                  </Button>
                ) : null}
                {result.page < result.pageCount ? (
                  <Button asChild size="sm">
                    <Link href={query(result.page + 1)}>Next</Link>
                  </Button>
                ) : null}
              </span>
            </div>
          </>
        )}
      </section>
    </Page>
  );
}

async function SimilarParts({ partId }: { partId: string }) {
  let result;
  try {
    result = await findSimilarForPart(db, partId, 10);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { target, matches, benchmark } = result;
  const back = `/rfqs/${target.rfqId}/parts/${target.partId}`;
  const facts = [
    target.materialGrade,
    target.weightKg ? `${target.weightKg} kg` : null,
    target.inputForm === "FORGING" ? "forged" : "bar-turned",
    target.processHints.length ? `drawing: ${target.processHints.join(", ")}` : null,
  ].filter(Boolean);

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Past quotes", href: "/past-quotes" }, { label: "Similar parts" }]}
        title={`Parts like ${target.description}`}
        meta={
          <span>
            {target.rfqNumber} · {facts.join(" · ")}. Same input form, ranked by name, shape, material, weight, processes and recency; {Math.round(THRESHOLD * 100)} % or better.
            {benchmark ? ` Median conversion ₹${formatNumber(benchmark.medianConversionPerKg, 2)}/kg over ${benchmark.count} quotes.` : ""}
          </span>
        }
        actions={
          <Button asChild>
            <Link href={back}>
              <ArrowLeft /> Back to costing
            </Link>
          </Button>
        }
      />
      <section className="rounded-lg border border-line bg-surface">
        {matches.length === 0 ? (
          <EmptyState
            icon={History}
            title="No similar past parts"
            description="Nothing in the register is made the same way with a close enough name or shape. Search by hand instead."
            action={
              <Button asChild>
                <Link href={`/past-quotes?q=${encodeURIComponent(target.description.split(" ").slice(-1)[0] ?? "")}`}>Search past quotes</Link>
              </Button>
            }
          />
        ) : (
          <PastQuoteList rows={matches} showMatch />
        )}
      </section>
    </Page>
  );
}
