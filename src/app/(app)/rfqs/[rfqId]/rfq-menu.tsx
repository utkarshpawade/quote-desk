"use client";

import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { CLOSE_REASON_LABEL, rfqTransition, type CloseReason, type RfqStatus } from "@/domain/status";
import { closeRfqAction, reassignRfqAction, reviseRfqAction } from "../actions";

type Outcome = "WON" | "LOST" | "REGRETTED";

const itemClass =
  "flex h-8 cursor-pointer items-center rounded px-2.5 text-sm text-ink outline-none select-none data-[highlighted]:bg-hover data-[disabled]:cursor-default data-[disabled]:text-ink-4";

/** Less frequent RFQ actions: won / lost / regret, revise a sent quote, reassign. */
export function RfqMenu(props: {
  rfqId: string;
  status: RfqStatus;
  overdue: boolean;
  ownerId: string;
  estimators: Array<{ id: string; name: string }>;
  canClose: boolean;
  canRevise: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Outcome | "reassign" | null>(null);
  const [reason, setReason] = useState<CloseReason | "">("");
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState(props.ownerId);
  const [error, setError] = useState<string | null>(null);

  const allowed = (action: "MARK_WON" | "MARK_LOST" | "REGRET" | "REVISE") => rfqTransition(props.status, action) !== null;
  const items = [
    props.canClose && allowed("MARK_WON") && { key: "won", label: "Mark won…", onSelect: () => open("WON") },
    props.canClose && allowed("MARK_LOST") && { key: "lost", label: "Mark lost…", onSelect: () => open("LOST") },
    props.canClose && allowed("REGRET") && { key: "regret", label: "Decline to quote…", onSelect: () => open("REGRETTED") },
    props.canRevise && allowed("REVISE") && { key: "revise", label: "Start a revised quote", onSelect: revise },
    props.canClose && (props.status === "ESTIMATING" || props.status === "IN_APPROVAL") && { key: "reassign", label: "Reassign…", onSelect: () => setDialog("reassign") },
  ].filter(Boolean) as Array<{ key: string; label: string; onSelect: () => void }>;

  if (items.length === 0) return null;

  function open(outcome: Outcome) {
    setError(null);
    setNote("");
    // A lost RFQ that is past due was most likely lost to the late reply (the brief's main loss).
    setReason(outcome === "LOST" && props.overdue ? "LATE_REPLY" : "");
    setDialog(outcome);
  }

  function revise() {
    startTransition(async () => {
      const res = await reviseRfqAction({ rfqId: props.rfqId });
      if (res.ok) {
        toast.success("Revision started — the previous quote stays as sent until the new one goes out.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res =
        dialog === "reassign"
          ? await reassignRfqAction({ rfqId: props.rfqId, ownerId: owner })
          : await closeRfqAction({ rfqId: props.rfqId, outcome: dialog as Outcome, reason: dialog === "WON" ? null : (reason || null), note: note || null });
      if (res.ok) {
        setDialog(null);
        toast.success(dialog === "reassign" ? "RFQ reassigned." : "RFQ updated.");
        router.refresh();
      } else setError(res.error);
    });
  }

  const title = dialog === "WON" ? "Mark as won" : dialog === "LOST" ? "Mark as lost" : dialog === "REGRETTED" ? "Decline to quote" : "Reassign RFQ";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions" disabled={pending}>
            <MoreHorizontal />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
            {items.map((item) => (
              <DropdownMenu.Item key={item.key} className={itemClass} onSelect={item.onSelect}>
                {item.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Modal
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={title}
        description={dialog === "REGRETTED" ? "Record why Company A is not quoting. The customer is not notified." : undefined}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              {dialog === "reassign" ? "Reassign" : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {dialog === "reassign" ? (
            <Field label="Estimator" htmlFor="owner">
              <Select id="owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {props.estimators.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              {dialog !== "WON" ? (
                <Field label="Reason" htmlFor="reason" hint={reason === "LATE_REPLY" ? "Pre-selected because the RFQ is past its due date." : undefined}>
                  <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value as CloseReason)} required>
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {(Object.keys(CLOSE_REASON_LABEL) as CloseReason[]).map((r) => (
                      <option key={r} value={r}>
                        {CLOSE_REASON_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label="Note (optional)" htmlFor="note">
                <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the customer said, competitor price, …" />
              </Field>
            </>
          )}
          {error ? <p className="text-dense text-danger">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
