"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { db } from "@/server/db";
import { startSampleIntake } from "@/server/intake/samples";
import {
  acceptAgreed,
  acceptColumn,
  addTextSource,
  addTypedField,
  createIntake,
  createRfqFromIntake,
  decideField,
  discardIntake,
} from "@/server/services/intake";

const id = z.string().min(1).max(40);

export const createIntakeAction = defineAction({ input: z.object({}), permission: "intake.run" }, async (_input, user) => ({ sessionId: await createIntake(db, user) }));

export const addTextSourceAction = defineAction(
  {
    input: z.object({
      sessionId: id,
      label: z.string().trim().min(1).max(200),
      text: z.string().max(100_000),
      from: z.string().max(300).nullable(),
      subject: z.string().max(300).nullable(),
      date: z.string().max(100).nullable(),
    }),
    permission: "intake.run",
  },
  async (input) => ({ sourceId: await addTextSource(db, input) }),
);

export const startSampleAction = defineAction(
  { input: z.object({ pack: z.string().max(60) }), permission: "intake.run" },
  async (input, user) => ({ sessionId: await startSampleIntake(db, user, input.pack) }),
);

function refresh(sessionId: string) {
  revalidatePath(`/intake/${sessionId}`);
}

export const decideFieldAction = defineAction(
  {
    input: z.object({ sessionId: id, fieldId: id, action: z.enum(["ACCEPT", "EDIT", "REJECT", "UNDO"]), value: z.string().max(300).nullable() }),
    permission: "intake.run",
  },
  async (input, user) => {
    await decideField(db, user, input);
    refresh(input.sessionId);
    return null;
  },
);

export const addTypedFieldAction = defineAction(
  { input: z.object({ sessionId: id, partKey: z.string().max(60), fieldKey: z.string().max(40), value: z.string().max(300) }), permission: "intake.run" },
  async (input, user) => {
    await addTypedField(db, user, input);
    refresh(input.sessionId);
    return null;
  },
);

export const acceptColumnAction = defineAction(
  { input: z.object({ sessionId: id, sourceId: id, letter: z.string().regex(/^[A-Z]{1,3}$/) }), permission: "intake.run" },
  async (input, user) => {
    const count = await acceptColumn(db, user, input);
    refresh(input.sessionId);
    return { count };
  },
);

export const acceptAgreedAction = defineAction(
  { input: z.object({ sessionId: id, partKey: z.string().max(60) }), permission: "intake.run" },
  async (input, user) => {
    const count = await acceptAgreed(db, user, input);
    refresh(input.sessionId);
    return { count };
  },
);

export const createRfqFromIntakeAction = defineAction(
  { input: z.object({ sessionId: id, customerId: id, ownerId: id }), permission: "rfq.create" },
  async (input, user) => {
    const rfq = await createRfqFromIntake(db, user, input);
    revalidatePath("/rfqs");
    return { rfqId: rfq.id, number: rfq.number };
  },
);

export const discardIntakeAction = defineAction({ input: z.object({ sessionId: id }), permission: "intake.run" }, async (input, user) => {
  await discardIntake(db, user, input.sessionId);
  revalidatePath("/rfqs");
  return null;
});
