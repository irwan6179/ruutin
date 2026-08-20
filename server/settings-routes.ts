import {
  AuthorizationError,
  clearSessionCookie,
  PARENT_SESSION_COOKIE,
  requireParentContext,
  type D1DatabaseLike,
} from "./auth-context";
import { publicErrorResponse } from "./error-safety";
import { assertCsrf, jsonResponse } from "./http-security";
import {
  clearDeletionReauthCookie,
  consumeHouseholdDeletionTac,
  deleteHouseholdForParent,
  exportHouseholdForParent,
  getParentSettings,
  issueDeletionReauthCookie,
  requestHouseholdDeletionTac,
  serializeDeletionReauthCookie,
  updateParentTimezone,
} from "./settings";
import type { EmailSender } from "./email-adapter";
import { ValidationError } from "./validation";

export type SettingsRouteDependencies = Readonly<{
  db: D1DatabaseLike;
  sessionSecret: string;
  authHmacSecret: string;
  emailSender: EmailSender;
  now?: Date;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<JsonRecord> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 8 * 1024) {
    throw new ValidationError("body", "request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 8 * 1024) {
    throw new ValidationError("body", "request body is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ValidationError("body", "request body is invalid");
  }
  if (!isRecord(value)) throw new ValidationError("body", "request body is invalid");
  return value;
}

function onlyKeys(body: JsonRecord, keys: readonly string[]): void {
  if (Object.keys(body).some((key) => !keys.includes(key))) {
    throw new ValidationError("body", "request body contains unsupported fields");
  }
}

function privateResponse(value: unknown, init: ResponseInit = {}): Response {
  const response = jsonResponse(value, init, { private: true });
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function requireSettingsParent(
  request: Request,
  dependencies: SettingsRouteDependencies,
) {
  const context = await requireParentContext(request, dependencies.db, {
    sessionSecret: dependencies.sessionSecret,
    now: dependencies.now,
  });
  if (context.role !== "parent") throw new AuthorizationError();
  return context;
}

export async function handleParentSettings(
  request: Request,
  dependencies: SettingsRouteDependencies,
): Promise<Response> {
  try {
    const method = request.method.toUpperCase();
    if (!["GET", "PATCH"].includes(method)) {
      return privateResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "GET, PATCH" } },
      );
    }
    const context = await requireSettingsParent(request, dependencies);
    if (method === "GET") {
      return privateResponse(
        { settings: await getParentSettings(dependencies.db, context) },
        { status: 200 },
      );
    }
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["timezone"]);
    const household = await updateParentTimezone(dependencies.db, context, body.timezone);
    return privateResponse({ household }, { status: 200 });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentHouseholdExport(
  request: Request,
  dependencies: SettingsRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "GET") {
      return privateResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "GET" } },
      );
    }
    const context = await requireSettingsParent(request, dependencies);
    const payload = await exportHouseholdForParent(dependencies.db, context, { now: dependencies.now });
    const response = privateResponse(payload, { status: 200 });
    response.headers.set("Content-Disposition", 'attachment; filename="ruutin-household-export.json"');
    return response;
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleHouseholdDeletionChallenge(
  request: Request,
  dependencies: SettingsRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "POST") {
      return privateResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    assertCsrf(request);
    const context = await requireSettingsParent(request, dependencies);
    const body = await readBody(request);
    onlyKeys(body, []);
    await requestHouseholdDeletionTac(dependencies, context, request, { now: dependencies.now });
    return privateResponse(
      { ok: true, message: "If this parent account can receive a deletion code, one is on its way." },
      { status: 202 },
    );
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleHouseholdDeletionVerify(
  request: Request,
  dependencies: SettingsRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "POST") {
      return privateResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    assertCsrf(request);
    const context = await requireSettingsParent(request, dependencies);
    const body = await readBody(request);
    onlyKeys(body, ["code"]);
    const result = await consumeHouseholdDeletionTac(
      dependencies.db,
      context,
      body.code,
      dependencies.authHmacSecret,
      { now: dependencies.now },
    );
    const nowDate = dependencies.now ?? new Date();
    const ttlMs = Math.max(1, new Date(result.expiresAt).getTime() - nowDate.getTime());
    const marker = await issueDeletionReauthCookie(context, result.challengeId, dependencies.authHmacSecret, { now: nowDate, ttlMs });
    const response = privateResponse({ ok: true }, { status: 200 });
    response.headers.append("Set-Cookie", serializeDeletionReauthCookie(marker, Math.ceil(ttlMs / 1000)));
    return response;
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleHouseholdDeletion(
  request: Request,
  dependencies: SettingsRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "POST") {
      return privateResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    assertCsrf(request);
    const context = await requireSettingsParent(request, dependencies);
    const body = await readBody(request);
    onlyKeys(body, ["confirmation"]);
    await deleteHouseholdForParent(
      dependencies.db,
      context,
      request,
      dependencies.authHmacSecret,
      body.confirmation,
      { now: dependencies.now },
    );
    const response = privateResponse({ ok: true }, { status: 200 });
    response.headers.append("Set-Cookie", clearSessionCookie(PARENT_SESSION_COOKIE));
    response.headers.append("Set-Cookie", clearDeletionReauthCookie());
    return response;
  } catch (error) {
    return publicErrorResponse(error);
  }
}
