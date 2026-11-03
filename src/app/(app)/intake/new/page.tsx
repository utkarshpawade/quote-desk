import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { formatDateTime } from "@/lib/format";
import { aiConfig } from "@/server/ai/groq";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { SAMPLE_PACKS } from "@/server/intake/samples";
import { IntakeStart } from "./intake-start";

export const metadata: Metadata = { title: "New RFQ" };

export default async function NewRfqPage() {
  await requirePermission("intake.run");
  const ai = aiConfig();
  const open = await db.intakeSession.findMany({
    where: { status: { in: ["EXTRACTING", "REVIEW"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { createdBy: { select: { name: true } }, sources: { select: { label: true }, take: 1, orderBy: { createdAt: "asc" } }, _count: { select: { fields: { where: { status: "PENDING" } } } } },
  });

  return (
    <Page className="max-w-5xl">
      <PageHeader
        crumbs={[{ label: "RFQs", href: "/rfqs" }, { label: "New RFQ" }]}
        title="New RFQ"
        meta="Drop the customer's email — its Excel part list and drawings come with it — or add the files one by one. Every value read from them waits for your decision."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <IntakeStart samples={SAMPLE_PACKS.map((p) => ({ ...p }))} />
        <div className="flex flex-col gap-5">
          <Section title="How documents are read">
            <ul className="flex flex-col gap-2 text-dense text-ink-2">
              <li>
                {ai.apiKey ? (
                  <>
                    AI: <span className="font-mono text-xs">{ai.textModel}</span> on Groq, which does not train on submitted data. Only the email body and the drawing title block are sent.
                  </>
                ) : (
                  <span className="text-warn">No AI key is configured: emails and title blocks are read by rules, which find labelled values only.</span>
                )}
              </li>
              <li>Excel part lists are read cell by cell, no AI needed.</li>
              <li>Each value shows where it was found; nothing is used until you accept it.</li>
              <li>Customers whose NDA forbids AI are read by rules only.</li>
            </ul>
          </Section>
          {open.length ? (
            <Section title="Intakes in progress" flush>
              <ul className="divide-y divide-line">
                {open.map((s) => (
                  <li key={s.id}>
                    <Link href={`/intake/${s.id}`} className="block px-4 py-2.5 text-dense hover:bg-subtle/60">
                      <span className="block truncate font-medium">{s.sources[0]?.label ?? "Untitled intake"}</span>
                      <span className="text-xs text-ink-3">
                        {s.createdBy.name} · {formatDateTime(s.createdAt)} · {s._count.fields} to decide
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
