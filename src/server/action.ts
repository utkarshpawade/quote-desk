import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { Permission } from "@/domain/permissions";
import { requirePermission, requireUser, type CurrentUser } from "./auth/session";
import { UserError } from "./errors";

/** What every server action returns to the client: data, or a message fit for the user. */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Set on every function built by `defineAction`; a test asserts all server actions carry it. */
export const ACTION_MARKER = Symbol.for("quote-desk.action");

/**
 * Runs an action body and converts failures into an ActionResult. Validation errors become
 * field errors, UserErrors keep their message, anything unexpected is logged and hidden.
 * Next.js control flow (redirect, notFound) is rethrown untouched.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof z.ZodError) {
      return { ok: false, error: "Some values need attention.", fieldErrors: zodFieldErrors(error) };
    }
    if (error instanceof UserError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    console.error("[action] unexpected error", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * The only way server actions are declared: input is parsed with zod, the session is checked
 * (and the permission, when given) before the handler runs, and the result is an ActionResult.
 *
 *   export const approveQuote = defineAction(
 *     { input: ApproveInput, permission: "quote.approve" },
 *     async (input, user) => quoteService.approve(user, input),
 *   );
 */
export function defineAction<Schema extends z.ZodType, Output>(
  config: { input: Schema; permission?: Permission },
  handler: (input: z.output<Schema>, user: CurrentUser) => Promise<Output>,
): ((raw: z.input<Schema>) => Promise<ActionResult<Output>>) & { [ACTION_MARKER]: true } {
  const action = async (raw: z.input<Schema>) =>
    runAction(async () => {
      const user = config.permission
        ? await requirePermission(config.permission)
        : await requireUser();
      const input = config.input.parse(raw);
      return handler(input, user);
    });
  return Object.assign(action, { [ACTION_MARKER]: true as const });
}
