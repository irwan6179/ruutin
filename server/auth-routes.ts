import {
  getCookie,
  PARENT_SESSION_COOKIE,
  revokeParentSession,
  serializeSessionCookie,
  clearSessionCookie,
  type D1DatabaseLike,
} from "./auth-context";
import { publicErrorResponse } from "./error-safety";
import {
  assertCsrf,
  CSRF_COOKIE_NAME,
  issueCsrfToken,
  jsonResponse,
} from "./http-security";
import { D1RateLimitStore } from "./rate-limit";
import {
  buildTacEmail,
  getRequestSource,
  requestParentTac,
  TAC_REQUEST_MESSAGE,
  type TacRequestDependencies,
} from "./auth-service";
import { verifyTac } from "./tac";
import { ValidationError } from "./validation";
import type { EmailSender } from "./email-adapter";

const MAX_AUTH_BODY_BYTES = 8 * 1024;

export type AuthRouteDependencies = Readonly<{
  db: D1DatabaseLike;
  authHmacSecret: string;
  sessionSecret: string;
  emailSender: EmailSender;
  now?: Date;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readAuthBody(request: Request): Promise<JsonRecord> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_AUTH_BODY_BYTES) {
    throw new ValidationError("body", "request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AUTH_BODY_BYTES) {
    throw new ValidationError("body", "request body is too large");
  }
  if (request.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("body", "request body is invalid");
  }
  if (!isRecord(parsed)) throw new ValidationError("body", "request body is invalid");
  return parsed;
}

function csrfBootstrapResponse(request: Request): Response {
  const existing = getCookie(request, CSRF_COOKIE_NAME);
  const csrf = existing ? { token: existing, cookie: null } : issueCsrfToken();
  const response = jsonResponse(
    {
      ok: true,
      csrfToken: csrf.token,
    },
    { status: 200 },
    { private: true },
  );
  if (csrf.cookie) response.headers.append("Set-Cookie", csrf.cookie);
  return response;
}

export function handleTacRequestBootstrap(request: Request): Response {
  return csrfBootstrapResponse(request);
}

function dependenciesWithRateStore(dependencies: AuthRouteDependencies): TacRequestDependencies {
  return {
    db: dependencies.db,
    authHmacSecret: dependencies.authHmacSecret,
    rateLimitStore: new D1RateLimitStore(dependencies.db),
    emailSender: dependencies.emailSender,
  };
}

export async function handleTacRequest(
  request: Request,
  dependencies: AuthRouteDependencies,
): Promise<Response> {
  if (request.method.toUpperCase() === "GET") return csrfBootstrapResponse(request);
  try {
    assertCsrf(request);
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "GET, POST" } },
      );
    }
    const body = await readAuthBody(request);
    await requestParentTac(
      dependenciesWithRateStore(dependencies),
      body.email,
      getRequestSource(request.headers),
      { now: dependencies.now },
    );
    // Known, unknown, and newly-created parents receive the same public body.
    return jsonResponse(
      { ok: true, message: TAC_REQUEST_MESSAGE },
      { status: 202 },
      { private: true },
    );
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleTacVerify(
  request: Request,
  dependencies: AuthRouteDependencies,
): Promise<Response> {
  try {
    assertCsrf(request);
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    const body = await readAuthBody(request);
    const result = await verifyTac(
      dependencies.db,
      body.email,
      body.code,
      dependencies.authHmacSecret,
      {
        now: dependencies.now,
        sessionSecret: dependencies.sessionSecret,
      },
    );
    const response = jsonResponse(
      { ok: true },
      { status: 200 },
      { private: true },
    );
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(PARENT_SESSION_COOKIE, result.sessionToken),
    );
    return response;
  } catch (error) {
    // Invalid/expired/consumed/locked are intentionally indistinguishable.
    return publicErrorResponse(error);
  }
}

export async function handleParentSignOut(
  request: Request,
  dependencies: AuthRouteDependencies,
): Promise<Response> {
  try {
    assertCsrf(request);
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    await revokeParentSession(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    const response = jsonResponse(
      { ok: true },
      { status: 200 },
      { private: true },
    );
    response.headers.append("Set-Cookie", clearSessionCookie(PARENT_SESSION_COOKIE));
    return response;
  } catch (error) {
    return publicErrorResponse(error);
  }
}

// Keep the email copy import available to route-level tests that inject a
// sender and want to assert the exact parent-safe subject/body.
export { buildTacEmail };
