"use client";

import { CircleAlert, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Section } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatINR, formatInteger, formatNumber } from "@/lib/format";
import type { QuotePage } from "@/server/services/quote-page";
import { approveQuoteAction, returnQuoteAction, sendQuoteAction } from "../actions";

const VIA: Record<string, string> = { COLUMN: "by column", AGREED: "agreed", SINGLE: "single", EDITED: "edited" };

/**
 * The sales head's internal view beside the customer document: margins against the floor,
 * warnings, how the values were accepted, the rate basis — and approve / return / send.
 */
export function ApprovalRail({ page, canApprove, canSend }: { page: QuotePage; canApprove: boolean; canSend: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"approve" | "return" | "send" | null>(null);
  const [note, setNote] = useState("");
  const [tagged, setTagged] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState({
    to: page.customer.contactEmail ?? "",
    cc: "",
    subject: `Quotation ${page.number} — ${page.rfq.subject}`,
    message: `Dear Sir/Madam,\n\nPlease find attached our quotation ${page.number} against your RFQ.\nPrices are ex-GST; GST is shown separately per part.\n\nRegards,\nCompany A`,
  });

  const a = page.approval;
  const awaiting = page.status === "IN_APPROVAL" && canApprove;
  const sendable = page.status === "APPROVED" && canSend;

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setMode(null);
        toast.success(success);
        router.refresh();
      } else setError(res.error);
    });
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      {awaiting ? (
        <>
          <Button variant="primary" onClick={() => (setMode("approve"), setNote(""))} disabled={!page.snapshot}>
            Approve
          </Button>
          <Button onClick={() => (setMode("return"), setNote(""), setTagged([]))}>Return to estimator</Button>
        </>
      ) : null}
      {sendable ? (
        <Button variant="primary" onClick={() => setMode("send")}>
          <Mail /> Send to customer
        </Button>
      ) : null}
      <Button asChild variant="ghost">
        <a href={`/api/quotes/${page.id}/pdf`} download>
          Download PDF
        </a>
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Section title={awaiting ? "Your approval" : "Status"} description={page.statusLabel}>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-dense">
          <dt className="text-ink-3">Approval value</dt>
          <dd className="num font-semibold">{formatINR(a.approvalValue)}</dd>
          <dt className="text-ink-3">Threshold</dt>
          <dd className="num text-ink-3">{formatINR(a.threshold)}</dd>
          <dt className="text-ink-3">Tooling charged separately</dt>
          <dd className="num text-ink-3">{formatINR(a.toolingValue)}</dd>
        </dl>
        <p className="mt-2 text-dense">
          {a.requiresApproval ? (
            <>Needs sales head approval: {formatINR(a.approvalValue)} &gt; {formatINR(a.threshold)}</>
          ) : (
            <>Within the threshold: approved by rule on submit</>
          )}
        </p>
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-xs text-ink-3">
          {page.submitted ? (
            <li>
              Submitted by {page.submitted.by} · {formatDateTime(page.submitted.at)}
            </li>
          ) : null}
          {page.decided && page.status !== "DRAFT" ? (
            <li>
              {page.requiresApproval ? `Approved by ${page.decided.by}` : "Approved by rule"} · {formatDateTime(page.decided.at)}
            </li>
          ) : null}
          {page.decided && page.status === "DRAFT" ? (
            <li className="text-warn">
              Returned by {page.decided.by} · “{page.decided.note}”
            </li>
          ) : null}
          {page.sent ? (
            <li>
              Sent to {page.sent.to} by {page.sent.by} · {formatDateTime(page.sent.at)}
            </li>
          ) : null}
          <li>
            Rates as of {formatDate(page.basisDate)}
            {page.basisReason ? ` — ${page.basisReason}` : ""}
            {page.snapshot ? (
              <>
                {" "}· frozen <span className="font-mono">#{page.snapshot.hash.slice(0, 8)}</span>
              </>
            ) : null}
          </li>
        </ul>
        <div className="mt-4 hidden xl:block">{actions}</div>
      </Section>

      <Section title="Parts" description="Lowest margin across the quoted volumes, against the floor." flush>
        <ul className="divide-y divide-line">
          {page.parts.map((p) => (
            <li key={p.partId} className="px-4 py-3 text-dense">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/rfqs/${page.rfq.id}/parts/${p.partId}`} className="font-medium hover:text-accent hover:underline underline-offset-2">
                  {p.lineNo}. {p.description}
                </Link>
                <span className="num">{p.baseUnitPrice ? `₹${formatNumber(p.baseUnitPrice, 2)}` : "—"}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-3">
                {p.baseVolume ? `${formatInteger(p.baseVolume)}/yr` : ""}
                {p.pricePerKg ? ` · ₹${formatNumber(p.pricePerKg, 2)}/kg` : ""} · lowest margin{" "}
                <span className={cn(p.belowFloor ? "font-medium text-warn" : "text-ink-2")}>
                  {p.lowestMarginPct ?? "—"} %{p.belowFloor && page.marginFloor ? ` (floor ${Number(page.marginFloor)} %)` : ""}
                </span>
              </p>
              {p.provenance.total ? (
                <p className="mt-0.5 text-xs text-ink-3">
                  {p.provenance.total} values from the RFQ documents accepted by {p.provenance.acceptedBy.join(", ")} —{" "}
                  {Object.entries(p.provenance.byVia)
                    .map(([via, n]) => `${n} ${VIA[via] ?? via.toLowerCase()}`)
                    .join(", ")}
                </p>
              ) : null}
              {p.warnings.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-warn">
                  {p.warnings.map((w, i) => (
                    <li key={i} className="flex gap-1.5">
                      <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                      {w}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {page.outbox.length ? (
        <Section title="Sent messages" description="Mock email — nothing leaves the system; the PDF sent is stored.">
          <ul className="flex flex-col gap-3 text-dense">
            {page.outbox.map((m) => (
              <li key={m.id}>
                <p className="font-medium">{m.subject}</p>
                <p className="text-xs text-ink-3">
                  To {m.to}
                  {m.cc ? `, cc ${m.cc}` : ""} · {formatDateTime(m.createdAt)}
                </p>
                <a href={`/api/files/${m.pdfFileId}`} download className="text-xs text-accent hover:underline underline-offset-2">
                  PDF as sent
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Phones and tablets: actions stay at hand. */}
      {awaiting || sendable ? <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur xl:hidden">{actions}</div> : null}

      <Modal
        open={mode === "approve" || mode === "return"}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "approve" ? `Approve ${page.number}` : `Return ${page.number} to ${page.rfq.owner}`}
        description={mode === "approve" ? "You are approving the document on the left, frozen as shown." : "Say what needs to change. Tagged parts show your note above their inputs."}
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                mode === "approve"
                  ? run(() => approveQuoteAction({ quoteId: page.id, rfqId: page.rfq.id, snapshotId: page.snapshot!.id, note: note || null }), "Approved — you can send it now.")
                  : run(() => returnQuoteAction({ quoteId: page.id, rfqId: page.rfq.id, snapshotId: page.snapshot!.id, note, partIds: tagged }), "Returned to the estimator.")
              }
            >
              {mode === "approve" ? "Approve" : "Return"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={mode === "approve" ? "Note (optional)" : "What should change"} htmlFor="decision-note">
            <Textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {mode === "return" ? (
            <fieldset>
              <legend className="mb-1.5 text-dense font-medium text-ink-2">Parts to revisit</legend>
              <div className="flex flex-col gap-1.5">
                {page.parts.map((p) => (
                  <label key={p.partId} className="flex items-center gap-2 text-dense">
                    <input type="checkbox" checked={tagged.includes(p.partId)} onChange={(e) => setTagged(e.target.checked ? [...tagged, p.partId] : tagged.filter((x) => x !== p.partId))} className="size-4 accent-[var(--color-accent)]" />
                    {p.lineNo}. {p.description}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {error ? <p className="text-dense text-danger">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={mode === "send"}
        onOpenChange={(o) => !o && setMode(null)}
        title={`Send ${page.number}`}
        description="Mock email: the message and the exact PDF are stored with the quote; nothing is sent outside the system."
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => run(() => sendQuoteAction({ quoteId: page.id, rfqId: page.rfq.id, ...mail }), "Quote sent (mock email).")}>
              Send
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="To" htmlFor="mail-to">
            <Input id="mail-to" type="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} />
          </Field>
          <Field label="Cc (optional)" htmlFor="mail-cc">
            <Input id="mail-cc" type="email" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} />
          </Field>
          <Field label="Subject" htmlFor="mail-subject">
            <Input id="mail-subject" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
          </Field>
          <Field label="Message" htmlFor="mail-body" hint={`Attachment: ${page.number}.pdf`}>
            <Textarea id="mail-body" rows={6} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} />
          </Field>
          {error ? <p className="text-dense text-danger">{error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
