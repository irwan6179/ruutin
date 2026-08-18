import {
  COMPANION_SESSION_COOKIE,
  getCookie,
  serializeSessionCookie,
  timingSafeEqual,
  type D1DatabaseLike,
} from "./auth-context";
import { createOpaqueToken } from "./validation";
import { requestSourceFromHeaders } from "./auth-service";
import { publicErrorResponse } from "./error-safety";
import { assertSameOrigin, jsonResponse } from "./http-security";
import {
  consumePairingChallenge,
  hashPairingCode,
  previewPairingChallenge,
} from "./pairing";
import {
  D1RateLimitStore,
  enforceRateLimit,
  rateLimitKey,
  type RateLimitPolicy,
} from "./rate-limit";
import { hmacSha256Base64Url } from "./tac";
import { ValidationError } from "./validation";

const MAX_PAIRING_BODY_BYTES = 8 * 1024;

/** Keep the unauthenticated pairing surface bounded even when no challenge row matches. */
export const PAIRING_ATTEMPT_POLICY: RateLimitPolicy = Object.freeze({
  limit: 5,
  windowMs: 10 * 60 * 1000,
});
export const PAIRING_BROWSER_COOKIE = "__Host-ruutin_pairing_browser";
export const PAIRING_PREVIEW_COOKIE = "__Host-ruutin_pairing_preview";
const PAIRING_PREVIEW_TTL_SECONDS = 2 * 60;

function issueBrowserBucket(request: Request): { value: string; setCookie: boolean } {
  const existing = getCookie(request, PAIRING_BROWSER_COOKIE);
  if (existing) return { value: existing, setCookie: false };
  return { value: createOpaqueToken(32), setCookie: true };
}

async function browserBucketKey(value: string, secret: string): Promise<string> {
  // The browser cookie itself is an identifier, not a credential. Still keep
  // it out of D1 so a database read cannot recover the raw value.
  const digest = await hmacSha256Base64Url(
    `ruutin-pairing-browser-v1\u0000${value}`,
    secret,
  );
  return rateLimitKey("pairing-browser", digest);
}

function encodeMarker(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeMarker(value: string): string | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return null;
  }
}

async function issuePreviewMarker(
  code: unknown,
  expiresAt: string,
  browserValue: string,
  secret: string,
): Promise<string> {
  const codeHash = await hashPairingCode(code, secret);
  const payload = encodeMarker(`${expiresAt}\u0000${codeHash}\u0000${browserValue}`);
  const signature = await hmacSha256Base64Url(
    `ruutin-pairing-preview-v1\u0000${payload}`,
    secret,
  );
  // Keep the cookie value inside the same safe token alphabet as session
  // cookies; a compact encoded tuple avoids separators rejected by parsing.
  return encodeMarker(`${payload}\u0000${signature}`);
}

async function acceptsPreviewMarker(
  request: Request,
  code: unknown,
  browserValue: string,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  const marker = getCookie(request, PAIRING_PREVIEW_COOKIE);
  if (!marker || marker.length > 1024) return false;
  const markerFields = decodeMarker(marker)?.split("\u0000");
  if (!markerFields || markerFields.length !== 2) return false;
  const [payload, signature] = markerFields;
  if (!payload || !signature) return false;
  const expectedSignature = await hmacSha256Base64Url(
    `ruutin-pairing-preview-v1\u0000${payload}`,
    secret,
  );
  if (!timingSafeEqual(signature, expectedSignature)) return false;
  const decoded = decodeMarker(payload);
  if (!decoded) return false;
  const fields = decoded.split("\u0000");
  if (fields.length !== 3) return false;
  const [expiresAt, codeHash, markerBrowser] = fields;
  if (!expiresAt || !codeHash || !markerBrowser || markerBrowser !== browserValue) return false;
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= now.getTime()) return false;
  try {
    const submittedCodeHash = await hashPairingCode(code, secret);
    return timingSafeEqual(codeHash, submittedCodeHash);
  } catch {
    return false;
  }
}

async function enforcePairingAttemptLimits(
  request: Request,
  db: D1DatabaseLike,
  secret: string,
  browserValue: string,
  now?: Date,
): Promise<void> {
  const store = new D1RateLimitStore(db);
  const source = requestSourceFromHeaders(request.headers);
  const browser = await browserBucketKey(browserValue, secret);
  await Promise.all([
    enforceRateLimit(
      store,
      rateLimitKey("pairing-source", source),
      PAIRING_ATTEMPT_POLICY,
      { now },
    ),
    enforceRateLimit(store, browser, PAIRING_ATTEMPT_POLICY, { now }),
  ]);
}

function appendBrowserBucketCookie(
  response: Response,
  browser: { value: string; setCookie: boolean } | null,
): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  if (browser?.setCookie) {
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(PAIRING_BROWSER_COOKIE, browser.value, {
        maxAgeSeconds: Math.ceil(PAIRING_ATTEMPT_POLICY.windowMs / 1000),
      }),
    );
  }
  return response;
}

function appendPreviewMarkerCookie(response: Response, marker: string | null): Response {
  if (marker) {
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(PAIRING_PREVIEW_COOKIE, marker, {
        maxAgeSeconds: PAIRING_PREVIEW_TTL_SECONDS,
      }),
    );
  }
  return response;
}

export type PairingRouteDependencies = Readonly<{
  db: D1DatabaseLike;
  authHmacSecret: string;
  /** Production supplies the distinct session secret; tests may omit it. */
  sessionSecret?: string;
  now?: Date;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<JsonRecord> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_PAIRING_BODY_BYTES) {
    throw new ValidationError("body", "request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PAIRING_BODY_BYTES) {
    throw new ValidationError("body", "request body is too large");
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

function onlyKeys(body: JsonRecord, keys: readonly string[]): void {
  if (Object.keys(body).some((key) => !keys.includes(key))) {
    throw new ValidationError("body", "request body contains unsupported fields");
  }
}

export async function handlePairing(
  request: Request,
  dependencies: PairingRouteDependencies,
): Promise<Response> {
  let browser: { value: string; setCookie: boolean } | null = null;
  let previewMarkerValid = false;
  try {
    if (request.method.toUpperCase() !== "POST") {
      return appendBrowserBucketCookie(jsonResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      ), null);
    }
    // Pairing is intentionally unauthenticated, but when a browser supplies
    // Origin, a same-origin check keeps a third-party site from driving the
    // confirmation UI. Non-browser/manual clients may omit Origin because the
    // one-use challenge itself is the credential.
    if (request.headers.get("origin")) assertSameOrigin(request);
    const body = await readBody(request);
    onlyKeys(body, ["code", "token", "confirm", "deviceLabel"]);
    const confirm = body.confirm === true;
    if (body.confirm !== undefined && typeof body.confirm !== "boolean") {
      throw new ValidationError("confirm", "confirm is invalid");
    }
    if (body.deviceLabel !== undefined && typeof body.deviceLabel !== "string") {
      throw new ValidationError("deviceLabel", "deviceLabel is invalid");
    }
    // A manual code has no challenge lookup key until it is correct. Spend a
    // D1-backed source bucket only for code-only submissions so an attacker
    // cannot enumerate six-digit codes; QR/token requests are guarded by the
    // challenge's own one-use/attempt state instead of this edge budget.
    const hasToken = body.token !== undefined && body.token !== null && body.token !== "";
    const hasCode = body.code !== undefined && body.code !== null && body.code !== "";
    if (hasCode && !hasToken) {
      browser = issueBrowserBucket(request);
      previewMarkerValid = confirm && await acceptsPreviewMarker(
        request,
        body.code,
        browser.value,
        dependencies.authHmacSecret,
        dependencies.now,
      );
      if (!previewMarkerValid) {
        await enforcePairingAttemptLimits(
          request,
          dependencies.db,
          dependencies.authHmacSecret,
          browser.value,
          dependencies.now,
        );
      }
    }
    if (!confirm) {
      const preview = await previewPairingChallenge(
        dependencies.db,
        { code: body.code, token: body.token },
        dependencies.authHmacSecret,
        { now: dependencies.now },
      );
      const response = appendBrowserBucketCookie(
        jsonResponse({ pairing: preview }, { status: 200 }, { private: true }),
        browser,
      );
      if (hasCode && !hasToken && browser) {
        const marker = await issuePreviewMarker(
          body.code,
          preview.expiresAt,
          browser.value,
          dependencies.authHmacSecret,
        );
        return appendPreviewMarkerCookie(response, marker);
      }
      return response;
    }
    const result = await consumePairingChallenge(
      dependencies.db,
      { code: body.code, token: body.token },
      dependencies.authHmacSecret,
      {
        now: dependencies.now,
        deviceLabel: body.deviceLabel as string | undefined,
        sessionSecret: dependencies.sessionSecret ?? dependencies.authHmacSecret,
      },
    );
    const response = jsonResponse(
      { ok: true, profile: { nickname: result.nickname, emoji: result.emoji } },
      { status: 201 },
      { private: true },
    );
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(COMPANION_SESSION_COOKIE, result.deviceToken),
    );
    if (previewMarkerValid) {
      response.headers.append(
        "Set-Cookie",
        serializeSessionCookie(PAIRING_PREVIEW_COOKIE, createOpaqueToken(16), { maxAgeSeconds: 0 }),
      );
    }
    return appendBrowserBucketCookie(response, browser);
  } catch (error) {
    return appendBrowserBucketCookie(publicErrorResponse(error), browser);
  }
}
