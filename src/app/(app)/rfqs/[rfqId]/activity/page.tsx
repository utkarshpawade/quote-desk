import { History } from "lucide-react";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";
import { db } from "@/server/db";
import { getRfqActivity } from "@/server/services/rfqs";
import { loadWorkspace } from "../data";

export default async function ActivityTab({ params }: { params: Promise<{ rfqId: string }> }) {
  const ws = await loadWorkspace((await params).rfqId);
  const events = await getRfqActivity(db, ws.id);
  return (
    <Section title="Activity" description="Every change to this RFQ, newest first. The log is append-only.">
      {events.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" />
      ) : (
        <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute top-1.5 -left-[24px] size-2 rounded-full border border-line-strong bg-surface" aria-hidden />
              <p className="text-sm">{e.summary}</p>
              <p className="text-xs text-ink-3">
                {e.actor} · {formatDateTime(e.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
