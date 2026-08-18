import {
  getCookie,
  timingSafeEqual,
} from "./auth-context";
import { createOpaqueToken } from "./validation";

export const CSRF_COOKIE_NAME = "__Host-ruutin_csrf";
export const CSRF_HEADER_NAME = "x-ruutin-csrf";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class CsrfError extends Error {
  readonly status = 403;

  constructor() {
    super("Request could not be verified");
    this.name = "CsrfError";
  }
}

export class OriginError extends Error {
  readonly status = 403;

  constructor() {
    super("Request origin could not be verified");
    this.name = "OriginError";
  }
}

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

function requestOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

/**
 * Require an exact Origin match.  A configured allow-list is for a canonical
 * Sites origin only; forwarded host headers are intentionally ignored.
 */
export function assertSameOrigin(
  request: Request,
  options: { allowedOrigins?: readonly string[] } = {},
): void {
  if (!isStateChangingMethod(request.method)) return;
  const origin = request.headers.get("origin");
  const currentOrigin = requestOrigin(request);
  if (!origin || !currentOrigin) throw new OriginError();
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    throw new OriginError();
  }
  const allowed = new Set([currentOrigin, ...(options.allowedOrigins ?? [])]);
  if (![...allowed].some((candidate) => candidate === parsedOrigin)) {
    throw new OriginError();
  }
}

export function serializeCsrfCookie(token: string, maxAgeSeconds = 60 * 60 * 24): string {
  if (!/^[A-Za-z0-9_-]{32,512}$/u.test(token)) {
    throw new Error("Invalid CSRF token");
  }
  return [
    `${CSRF_COOKIE_NAME}=${token}`,
    "Path=/",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}

export function issueCsrfToken(): { token: string; cookie: string } {
  const token = createOpaqueToken(32);
  return { token, cookie: serializeCsrfCookie(token) };
}

/** Verify a double-submit token plus the request's exact origin. */
export function assertCsrf(
  request: Request,
  options: { allowedOrigins?: readonly string[] } = {},
): void {
  if (!isStateChangingMethod(request.method)) return;
  assertSameOrigin(request, options);
  const cookieToken = getCookie(request, CSRF_COOKIE_NAME);
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    throw new CsrfError();
  }
}

export const requireCsrf = assertCsrf;
export const verifyCsrf = assertCsrf;

export function applyPrivateHeaders(
  response: Response,
  options: { vary?: string } = {},
): Response {
  const next = new Response(response.body, response);
  next.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  next.headers.set("Pragma", "no-cache");
  next.headers.set("Expires", "0");
  next.headers.set("X-Content-Type-Options", "nosniff");
  next.headers.set("Referrer-Policy", "same-origin");
  next.headers.set("Vary", options.vary ?? "Cookie");
  return next;
}

export function applyPublicHeaders(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("X-Content-Type-Options", "nosniff");
  next.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return next;
}

export function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
  options: { private?: boolean } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  const response = new Response(JSON.stringify(value), {
    ...init,
    headers,
  });
  return options.private === false ? applyPublicHeaders(response) : applyPrivateHeaders(response);
}
