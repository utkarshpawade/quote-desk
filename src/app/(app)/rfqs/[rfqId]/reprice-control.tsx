"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { todayIst, toIstDate } from "@/domain/calendar";
import type { RepricePreview } from "@/server/services/quotes";
import { formatDate, formatInteger, formatNumber } from "@/lib/format";
import { previewRepriceAction, repriceAction } from "../actions";

/**
 * One quote-level line: which date the quote is priced on and whether newer rates exist.
 * Changing the date previews the per-tier price change before anything is rewritten.
 */
export function RepriceControl(props: {
  quoteId: string;
  rfqId: string;
  basisDate: string;
  basisReason: string | null;
  newerRates: RepricePreview["changedRates"];
  receivedAt: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const today = todayIst();
  const earliest = toIstDate(new Date(new Date(props.receivedAt).getTime() - 30 * 86_400_000));
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RepricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load(target: string) {
    setDate(target);
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const res = await previewRepriceAction({ quoteId: props.quoteId, basisDate: target });
      if (res.ok) setPreview(res.data);
      else setError(res.error);
    });
  }

  function apply() {
    startTransition(async () => {
      const res = await repriceAction({ quoteId: props.quoteId, rfqId: props.rfqId, basisDate: date, reason: date === today ? null : reason });
      if (res.ok) {
        setOpen(false);
        toast.success(`Re-priced on rates as of ${formatDate(date)}.`);
        router.refresh();
      } else setError(res.error);
    });
  }

  const current = props.newerRates.length === 0;
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dense text-ink-3">
        <span>
          Rates as of <span className="text-ink-2">{formatDate(props.basisDate)}</span>
          {props.basisReason ? <> — {props.basisReason}</> : null}
        </span>
        <span aria-hidden>·</span>
        {current ? (
          <span>all current</span>
        ) : (
          <span className="text-warn">
            {props.newerRates.length} newer rate{props.newerRates.length > 1 ? "s" : ""} since then
          </span>
        )}
        {props.canEdit ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setOpen(true);
              load(today);
            }}
          >
            {current ? "Change basis date" : "Re-price on today's rates"}
          </Button>
        ) : null}
      </p>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Re-price the quote"
        description="Every rate is looked up again on the new date. Nothing changes until you apply."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={apply} loading={pending} disabled={!preview || (date !== today && !reason.trim())}>
              Apply
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Price on rates as of" htmlFor="basis" hint={`Between ${formatDate(earliest)} and today`}>
              <Input id="basis" type="date" min={earliest} max={today} value={date} onChange={(e) => e.target.value && load(e.target.value)} />
            </Field>
            {date !== today ? (
              <Field label="Reason (shown to the approver)" htmlFor="basis-reason">
                <Input id="basis-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer asked for the Oct RM base" />
              </Field>
            ) : null}
          </div>

          {preview ? (
            <>
              {preview.changedRates.length ? (
                <ul className="text-dense text-ink-2">
                  {preview.changedRates.map((r) => (
                    <li key={r.code}>
                      {r.name}: {r.before ? formatNumber(r.before, 2) : "—"} → <span className="font-medium text-ink">{r.after ? formatNumber(r.after, 2) : "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-dense text-ink-3">No rate differs between the two dates — prices stay the same.</p>
              )}
              <TableScroll className="rounded-md border border-line">
                <Table>
                  <thead>
                    <tr>
                      <Th>Part</Th>
                      <Th numeric>Volume</Th>
                      <Th numeric>Now ₹</Th>
                      <Th numeric>After ₹</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.parts.flatMap((p) =>
                      p.tiers.map((t, i) => (
                        <Tr key={`${p.partNo}-${t.volume}`}>
                          <Td className="text-ink-2">{i === 0 ? p.description : ""}</Td>
                          <Td numeric>{formatInteger(t.volume)}</Td>
                          <Td numeric>{t.before ? formatNumber(t.before, 2) : "—"}</Td>
                          <Td numeric className={t.after !== t.before ? "font-medium" : ""}>
                            {t.after ? formatNumber(t.after, 2) : "—"}
                          </Td>
                        </Tr>
                      )),
                    )}
                  </tbody>
                </Table>
              </TableScroll>
            </>
          ) : pending ? (
            <p className="text-dense text-ink-3">Looking up rates…</p>
          ) : null}
          {error ? <p className="text-dense text-danger">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
