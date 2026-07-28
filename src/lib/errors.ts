/**
 * One error type for every rejection the API can return.
 *
 * `code` is a stable machine-readable identifier the client switches on; `message`
 * is written for the person who will read it in a toast. Business-rule rejections
 * (a full shift, an overlapping claim) are errors in exactly the same sense as an
 * auth failure, so they travel through the same channel rather than being special
 * return values that a caller could forget to check.
 */
export type ErrorCode =
  // auth
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  // generic
  | "NOT_FOUND"
  | "INVALID_INPUT"
  // claiming
  | "SHIFT_FULL"
  | "OVERLAPPING_CLAIM"
  | "ALREADY_CLAIMED"
  | "NOT_CLAIMED"
  | "SHIFT_CHANGED"
  | "WRONG_PROFESSION";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    /** Optional structured payload, e.g. which shift a claim collided with. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthenticated = () =>
  new ApiError("UNAUTHENTICATED", "Please sign in to continue.", 401);

export const forbidden = (message = "You do not have access to do that.") =>
  new ApiError("FORBIDDEN", message, 403);

export const notFound = (what = "That record") =>
  new ApiError("NOT_FOUND", `${what} could not be found.`, 404);

export const invalidInput = (
  message: string,
  details?: Record<string, unknown>,
) => new ApiError("INVALID_INPUT", message, 400, details);
