import { CostingEditor } from "@/components/costing/costing-editor";
import { can } from "@/domain/permissions";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getCostingView } from "@/server/services/quotes";
import { loadWorkspace } from "../../data";

export default async function PartCostingPage({ params }: { params: Promise<{ rfqId: string; partId: string }> }) {
  const user = await requireUser();
  const { rfqId, partId } = await params;
  const ws = await loadWorkspace(rfqId);
  const view = await getCostingView(db, rfqId, partId);
  const index = ws.parts.findIndex((p) => p.id === partId);
  const link = (i: number) => {
    const p = ws.parts[i];
    return p ? { href: `/rfqs/${rfqId}/parts/${p.id}`, label: `${p.lineNo}. ${p.description}` } : null;
  };

  return (
    <CostingEditor
      key={`${view.line.id}-${view.quote.basisDate}`}
      view={view}
      editable={view.quote.editable && can(user.role, "costing.edit")}
      rfqHref={`/rfqs/${rfqId}`}
      prev={index > 0 ? link(index - 1) : null}
      next={link(index + 1)}
    />
  );
}
