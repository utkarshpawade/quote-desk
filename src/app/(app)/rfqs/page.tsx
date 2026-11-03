import { FileInput, Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DueLabel, RfqStatusLabel } from "@/components/rfq/labels";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/states";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatDateTime, formatINRCompact } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listPendingIntakes } from "@/server/services/intake";
import { listCustomers, listEstimators, listRegister, registerViewCounts, salesHeadKpis, type RegisterChip, type RegisterView } from "@/server/services/rfqs";
import { RegisterToolbar } from "./register-toolbar";

export const metadata: Metadata = { title: "RFQs" };

const VIEWS: Array<{ key: RegisterView; label: string; count?: keyof Awaited<ReturnType<typeof registerViewCounts>> }> = [
  { key: "mine", label: "Mine", count: "mine" },
  { key: "open", label: "Open", count: "open" },
  { key: "approval", label: "Awaiting approval", count: "approval" },
  { key: "ready", label: "Ready to send", count: "ready" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const CHIPS: RegisterChip[] = ["overdue", "due-soon", "returned"];

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const counts = await registerViewCounts(db, user);

  const defaultView: RegisterView =
    user.role === "SALES_HEAD" ? (counts.approval > 0 ? "approval" : counts.ready > 0 ? "ready" : "open") : "mine";
  const view = (VIEWS.some((v) => v.key === params.view) ? params.view : defaultView) as RegisterView;
  const chip = CHIPS.includes(params.chip as RegisterChip) ? (params.chip as RegisterChip) : undefined;

  const [{ rows, chips }, estimators, customers, kpis, intakes] = await Promise.all([
    listRegister(db, user, { view, chip, q: params.q, ownerId: params.owner, customerId: params.customer }),
    listEstimators(db),
    listCustomers(db),
    user.role === "SALES_HEAD" ? salesHeadKpis(db) : null,
    listPendingIntakes(db),
  ]);

  const filtered = Boolean(params.q || params.owner || params.customer || chip);

  return (
    <Page>
      <PageHeader
        title="RFQs"
        meta={
          kpis ? (
            <span>
              Avg turnaround (30 days):{" "}
              <span className="font-medium text-ink">{kpis.avgTurnaroundDays === null ? "—" : `${kpis.avgTurnaroundDays} wd`}</span> · target 4 · win rate{" "}
              <span className="font-medium text-ink">{kpis.winRatePct === null ? "—" : `${kpis.winRatePct} %`}</span>
              {kpis.medianMinutesPerPart !== null ? (
                <>
                  {" "}· estimator time per part <span className="font-medium text-ink">{kpis.medianMinutesPerPart} min</span> (target 60)
                </>
              ) : null}
              {kpis.lateReplyLost > 0 ? (
                <>
                  {" "}· lost to late reply (12 months): <span className="font-medium text-danger">{kpis.lateReplyLost}</span>
                </>
              ) : null}
            </span>
          ) : (
            "RFQs you own, soonest due first."
          )
        }
        actions={
          <Button asChild variant="primary">
            <Link href="/intake/new">
              <Plus /> New RFQ
            </Link>
          </Button>
        }
      />

      <nav aria-label="Views" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {VIEWS.map((v) => {
            const active = v.key === view;
            const n = v.count ? counts[v.count] : null;
            return (
              <li key={v.key}>
                <Link
                  href={`/rfqs?view=${v.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap ${
                    active ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"
                  }`}
                >
                  {v.label}
                  {n ? <span className="num rounded-full bg-subtle px-1.5 text-xs leading-5 text-ink-2">{n}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {intakes.length ? (
        <section aria-label="Incoming RFQs waiting for review" className="mb-4 rounded-lg border border-ai-line bg-ai-soft/60 px-4 py-2.5">
          <p className="flex items-center gap-2 text-dense font-medium">
            <FileInput className="size-4 text-ai" aria-hidden />
            {intakes.length === 1 ? "1 incoming RFQ is" : `${intakes.length} incoming RFQs are`} waiting for review
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-dense">
            {intakes.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/intake/${i.id}`} className="font-medium text-accent hover:underline underline-offset-2">
                  {i.label}
                </Link>
                <span className="text-xs text-ink-3">
                  {i.createdBy} · {formatDateTime(i.createdAt)} · {i.pending} value{i.pending === 1 ? "" : "s"} to decide
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RegisterToolbar
        view={view}
        chip={chip}
        chips={chips}
        q={params.q ?? ""}
        owner={params.owner ?? ""}
        customer={params.customer ?? ""}
        estimators={estimators}
        customers={customers}
      />

      <section className="mt-3 rounded-lg border border-line bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filtered ? "No RFQs match these filters" : view === "mine" ? "Nothing on your desk" : "No RFQs here yet"}
            description={
              filtered
                ? "Clear a filter or search for something else."
                : view === "mine"
                  ? "New RFQs assigned to you will appear here, soonest due first."
                  : "RFQs move here as they progress."
            }
            action={
              filtered ? (
                <Button asChild>
                  <Link href={`/rfqs?view=${view}`}>Clear filters</Link>
                </Button>
              ) : (
                <Button asChild variant="primary">
                  <Link href="/intake/new">New RFQ</Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <TableScroll className="hidden sm:block">
              <Table>
                <thead>
                  <tr>
                    <Th>RFQ</Th>
                    <Th>Customer · subject</Th>
                    <Th>Owner</Th>
                    <Th>Received</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                    <Th numeric>Annual value</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Tr key={r.id} className="group hover:bg-subtle/60">
                      <Td className="h-11">
                        <Link href={`/rfqs/${r.id}`} className="font-mono text-dense text-accent group-hover:underline underline-offset-2">
                          {r.number}
                        </Link>
                      </Td>
                      <Td className="max-w-[28rem]">
                        <div className="truncate">
                          <span className="font-medium">{r.customerName}</span>
                          <span className="text-ink-3"> · {r.subject}</span>
                        </div>
                        <div className="truncate text-xs text-ink-3">
                          {r.partsCount} part{r.partsCount > 1 ? "s" : ""}
                          {r.firstPart && r.partsCount > 1 ? ` · ${r.firstPart} …` : ""}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-2">{r.owner.name}</Td>
                      <Td className="whitespace-nowrap text-ink-3">{formatDate(r.receivedAt)}</Td>
                      <Td className="whitespace-nowrap">
                        <div className="text-ink-2">{formatDate(r.dueDate)}</div>
                        <DueLabel due={r.due} className="text-xs" />
                      </Td>
                      <Td>
                        <RfqStatusLabel status={r.status} returned={r.returned} />
                      </Td>
                      <Td numeric className="text-ink-2">
                        {r.approvalValue ? formatINRCompact(r.approvalValue) : <span className="text-ink-4">—</span>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>

            <ul className="divide-y divide-line sm:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/rfqs/${r.id}`} className="block px-4 py-3 active:bg-subtle">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-dense text-accent">{r.number}</span>
                      <RfqStatusLabel status={r.status} returned={r.returned} />
                    </div>
                    <p className="mt-0.5 truncate text-sm">
                      <span className="font-medium">{r.customerName}</span>
                      <span className="text-ink-3"> · {r.partsCount} part{r.partsCount > 1 ? "s" : ""}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-3">
                      <span>Due {formatDate(r.dueDate)}</span>
                      <DueLabel due={r.due} />
                      <span>· {r.owner.name}</span>
                      {r.approvalValue ? <span>· {formatINRCompact(r.approvalValue)}</span> : null}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <p className="mt-3 text-xs text-ink-3">
        Annual value is shown once a quote is submitted: base-volume price × RFQ volume, plus tooling charged separately.
      </p>
    </Page>
  );
}
