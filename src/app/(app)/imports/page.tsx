import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/states";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/domain/permissions";
import { formatDateTime, formatInteger } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listImportBatches, SAMPLE_IMPORTS } from "@/server/services/past-quote-import";
import { ImportFlow } from "./import-flow";

export const metadata: Metadata = { title: "Import past quotes" };

export default async function ImportsPage() {
  const user = await requireUser();
  const batches = await listImportBatches(db);
  const allowed = can(user.role, "import.run");

  return (
    <Page className="max-w-[1100px]">
      <PageHeader
        title="Import past quotes"
        meta={
          <span>
            Bring the old Excel quote register into <Link href="/past-quotes" className="text-accent hover:underline">past quotes</Link>, so similar parts and their routings show up while
            costing. Re-importing is safe: a row is recognised by its quote no. and part no.
          </span>
        }
      />
      {allowed ? (
        <ImportFlow samples={Object.entries(SAMPLE_IMPORTS).map(([key, s]) => ({ key, label: s.label })).reverse()} />
      ) : (
        <p className="text-dense text-ink-3">Your role cannot import.</p>
      )}

      <section className="mt-8 rounded-lg border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Import history</h2>
        </header>
        {batches.length === 0 ? (
          <EmptyState icon={History} title="Nothing imported yet" description="Each import is listed here with what it added, skipped and left out." />
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>File</Th>
                  <Th>By</Th>
                  <Th numeric>Rows</Th>
                  <Th numeric>Imported</Th>
                  <Th numeric>Skipped</Th>
                  <Th numeric>Errors</Th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <Tr key={b.id} className="align-top">
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(b.createdAt)}</Td>
                    <Td className="max-w-[22rem]">
                      <div className="truncate">{b.filename}</div>
                      {b.issues.length ? (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-accent">
                            {b.issues.length} problem{b.issues.length === 1 ? "" : "s"} reported
                          </summary>
                          <ul className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto pb-2">
                            {b.issues.map((i, n) => (
                              <li key={n} className={i.severity === "error" ? "text-danger" : "text-warn"}>
                                Row {i.row}
                                {i.cell ? ` (${i.cell})` : ""}: <span className="text-ink-2">{i.message}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{b.createdBy}</Td>
                    <Td numeric>{formatInteger(b.rowsTotal)}</Td>
                    <Td numeric className="font-medium text-ok">
                      {formatInteger(b.rowsImported)}
                    </Td>
                    <Td numeric className="text-ink-2">
                      {formatInteger(b.rowsSkipped)}
                    </Td>
                    <Td numeric className={b.rowsFailed ? "text-danger" : "text-ink-3"}>
                      {formatInteger(b.rowsFailed)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </section>
    </Page>
  );
}
