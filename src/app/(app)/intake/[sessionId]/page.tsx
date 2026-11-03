import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getIntakeReview } from "@/server/services/intake";
import { IntakeReviewView } from "./intake-review";

export const metadata: Metadata = { title: "Review RFQ intake" };

export default async function IntakeReviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const user = await requirePermission("intake.run");
  const { sessionId } = await params;
  let review;
  try {
    review = await getIntakeReview(db, sessionId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (review.status === "COMPLETED" && review.rfq) redirect(`/rfqs/${review.rfq.id}`);

  return (
    <Page className="pb-32">
      <PageHeader
        crumbs={[{ label: "RFQs", href: "/rfqs" }, { label: "New RFQ", href: "/intake/new" }, { label: "Review" }]}
        title="Review what the documents say"
        meta="Accept, correct or reject each value. Nothing reaches the RFQ until you decide it; values you leave undecided follow the part and block its submission."
      />
      <IntakeReviewView review={review} currentUser={{ id: user.id, role: user.role }} />
    </Page>
  );
}
