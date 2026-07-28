import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError, invalidInput } from "@/lib/errors";

/**
 * Wraps a route handler so every failure leaves through one place and arrives at
 * the client in one shape: `{ error: { code, message, details? } }`.
 *
 * Without this, business-rule rejections tend to become ad-hoc 500s with a stack
 * trace, and the UI cannot tell "this shift is full" apart from "the server broke"
 * -- which is exactly the difference the brief asks to be surfaced clearly.
 */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<NextResponse | Response>,
) {
  return async (...args: T): Promise<NextResponse | Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            },
          },
          { status: error.status },
        );
      }

      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            error: {
              code: "INVALID_INPUT",
              message: firstZodMessage(error),
              details: { issues: error.issues },
            },
          },
          { status: 400 },
        );
      }

      console.error("Unhandled route error:", error);
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL",
            message: "Something went wrong. Please try again.",
          },
        },
        { status: 500 },
      );
    }
  };
}

function firstZodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That request was not valid.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Parse and validate a JSON body, converting failures into a 400. */
export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw invalidInput("Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
