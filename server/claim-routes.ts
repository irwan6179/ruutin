import {
  requireCompanionContext,
  requireParentContext,
  type D1DatabaseLike,
} from "./auth-context";
import {
  claimCompanionTask,
  completeTaskForParent,
  createManualAdjustmentForParent,
  getLedgerForParent,
  listPendingClaimsForParent,
  resolveTaskClaimForParent,
  reverseTaskLedgerForParent,
} from "./claims";
import { assertCsrf, assertSameOrigin, jsonResponse } from "./http-security";
import { publicErrorResponse } from "./error-safety";
import { ValidationError } from "./validation";

export type ClaimRouteDependencies = Readonly<{
  db: D1DatabaseLike;
  sessionSecret: string;
  now?: Date;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<JsonRecord> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) throw new ValidationError("body", "request body is too large");
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
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new ValidationError("body", "request body contains unsupported fields");
}

export async function handleCompanionClaim(
  request: Request,
  dependencies: ClaimRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
    }
    assertSameOrigin(request);
    const context = await requireCompanionContext(request, dependencies.db, { sessionSecret: dependencies.sessionSecret, now: dependencies.now });
    const body = await readBody(request);
    onlyKeys(body, ["taskId"]);
    const result = await claimCompanionTask(dependencies.db, context, body.taskId, { now: dependencies.now });
    return jsonResponse(result, { status: 201 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentClaims(
  request: Request,
  dependencies: ClaimRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParentContext(request, dependencies.db, { sessionSecret: dependencies.sessionSecret, now: dependencies.now });
    const method = request.method.toUpperCase();
    if (method === "GET") {
      return jsonResponse({ claims: await listPendingClaimsForParent(dependencies.db, context) }, { status: 200 }, { private: true });
    }
    if (method !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["claimId", "decision", "reason"]);
    const result = await resolveTaskClaimForParent(dependencies.db, context, body.claimId, body.decision as "approve" | "reject", { now: dependencies.now, reason: body.reason });
    return jsonResponse(result, { status: 200 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentCompletion(
  request: Request,
  dependencies: ClaimRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
    const context = await requireParentContext(request, dependencies.db, { sessionSecret: dependencies.sessionSecret, now: dependencies.now });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["profileId", "taskId", "dueDate", "reason"]);
    const result = await completeTaskForParent(dependencies.db, context, { profileId: body.profileId, taskId: body.taskId, dueDate: body.dueDate }, { now: dependencies.now, reason: body.reason });
    return jsonResponse(result, { status: 200 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentLedger(
  request: Request,
  dependencies: ClaimRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParentContext(request, dependencies.db, { sessionSecret: dependencies.sessionSecret, now: dependencies.now });
    const method = request.method.toUpperCase();
    if (method === "GET") {
      const profileId = new URL(request.url).searchParams.get("profileId");
      return jsonResponse(
        { ledger: await getLedgerForParent(dependencies.db, context, profileId) },
        { status: 200 },
        { private: true },
      );
    }
    if (method !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
    assertCsrf(request);
    const body = await readBody(request);
    const action = body.action;
    if (action === "reverse") {
      onlyKeys(body, ["action", "claimId", "reason"]);
      const result = await reverseTaskLedgerForParent(dependencies.db, context, body.claimId, body.reason, { now: dependencies.now });
      return jsonResponse(result, { status: 200 }, { private: true });
    }
    if (action === "adjust") {
      onlyKeys(body, ["action", "profileId", "starsDelta", "reason", "requestId"]);
      const result = await createManualAdjustmentForParent(dependencies.db, context, {
        profileId: body.profileId,
        starsDelta: body.starsDelta,
        reason: body.reason,
        requestId: body.requestId,
      }, { now: dependencies.now });
      return jsonResponse(result, { status: 201 }, { private: true });
    }
    throw new ValidationError("action", "action is invalid");
  } catch (error) {
    return publicErrorResponse(error);
  }
}
