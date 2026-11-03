/**
 * Errors that carry a message safe to show to the user. Anything else that reaches an action
 * boundary is logged and replaced with a generic message.
 */
export class UserError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export class ForbiddenError extends UserError {
  constructor(message = "Your role does not allow this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends UserError {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}

/** Someone else saved first (optimistic lock). */
export class ConflictError extends UserError {
  constructor(message = "This was changed by someone else. Reload to see the latest version.") {
    super(message);
    this.name = "ConflictError";
  }
}
