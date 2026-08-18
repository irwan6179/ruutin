import { AuthorizationError } from "./auth-context";
import { CsrfError, OriginError, jsonResponse } from "./http-security";
import { RateLimitError } from "./rate-limit";
import { ScopeError } from "./scoped-data";
import { PairingAtomicityError, PairingVerificationError } from "./pairing";
import { TacVerificationError } from "./tac";
import { ValidationError } from "./validation";

export type PublicError = {
  status: number;
  code: "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "invalid_request" | "server_error";
  message: string;
};

/** Convert internal failures to a stable response without leaking D1/provider details. */
export function toPublicError(error: unknown): PublicError {
  if (error instanceof AuthorizationError) {
    return { status: 401, code: "unauthorized", message: "Authentication required" };
  }
  if (error instanceof ScopeError) {
    return { status: 404, code: "not_found", message: "Resource not found" };
  }
  if (error instanceof CsrfError || error instanceof OriginError) {
    return { status: 403, code: "forbidden", message: "Request could not be verified" };
  }
  if (error instanceof RateLimitError) {
    return { status: 429, code: "rate_limited", message: "Too many requests" };
  }
  if (error instanceof TacVerificationError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "That code is invalid or has expired. Request a new code and try again.",
    };
  }
  if (error instanceof PairingVerificationError) {
    return {
      status: 400,
      code: "invalid_request",
      message: "That pairing request is invalid or has expired. Ask the parent for a new one.",
    };
  }
  if (error instanceof PairingAtomicityError) {
    return { status: 503, code: "server_error", message: "Pairing is temporarily unavailable" };
  }
  if (error instanceof ValidationError) {
    return { status: 400, code: "invalid_request", message: "Request is invalid" };
  }
  return { status: 500, code: "server_error", message: "Something went wrong" };
}

export function publicErrorResponse(error: unknown): Response {
  const publicError = toPublicError(error);
  const response = jsonResponse(
    { error: publicError.code, message: publicError.message },
    { status: publicError.status },
    { private: true },
  );
  if (publicError.status === 429 && error instanceof RateLimitError) {
    response.headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return response;
}

/** Structured operational fields safe for logs; never include raw causes/input. */
export function sanitizedLogContext(error: unknown): {
  errorType: string;
  status: number;
  code: PublicError["code"];
} {
  const publicError = toPublicError(error);
  return {
    errorType: error instanceof Error ? error.name.slice(0, 64) : "UnknownError",
    status: publicError.status,
    code: publicError.code,
  };
}
