import {
  requireCompanionContext,
  requireParentContext,
  type D1DatabaseLike,
} from "./auth-context";
import { publicErrorResponse } from "./error-safety";
import {
  assertCsrf,
  assertSameOrigin,
  jsonResponse,
} from "./http-security";
import {
  archiveRewardForParent,
  createRewardForParent,
  createRewardRequestForCompanion,
  getRewardForParent,
  listPendingRewardRequestsForParent,
  listRewardRequestsForParent,
  listRewardRequestsForCompanion,
  listRewardsForParent,
  resolveRewardRequestForParent,
  setActiveRewardForParent,
  updateRewardForParent,
} from "./rewards";
import { REWARD_TEMPLATES } from "../shared/reward-templates";
import { ValidationError } from "./validation";

export type RewardRouteDependencies = Readonly<{
  db: D1DatabaseLike;
  sessionSecret: string;
  now?: Date;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<JsonRecord> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 16 * 1024) {
    throw new ValidationError("body", "request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) {
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

function methodNotAllowed(allow: string): Response {
  return jsonResponse(
    { error: "method_not_allowed", message: "Method not allowed" },
    { status: 405, headers: { Allow: allow } },
  );
}

export async function handleParentRewards(
  request: Request,
  dependencies: RewardRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParentContext(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    const method = request.method.toUpperCase();
    if (method === "GET") {
      const profileId = new URL(request.url).searchParams.get("profileId") ?? undefined;
      return jsonResponse(
        {
          rewards: await listRewardsForParent(dependencies.db, context, profileId),
          templates: REWARD_TEMPLATES,
        },
        { status: 200 },
        { private: true },
      );
    }
    if (method !== "POST") return methodNotAllowed("GET, POST");
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["profileId", "title", "emoji", "starCost"]);
    const reward = await createRewardForParent(
      dependencies.db,
      context,
      {
        profileId: body.profileId,
        title: body.title,
        emoji: body.emoji,
        starCost: body.starCost,
      },
      { now: dependencies.now },
    );
    return jsonResponse({ reward }, { status: 201 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentReward(
  request: Request,
  dependencies: RewardRouteDependencies,
  rewardId: string,
): Promise<Response> {
  try {
    const context = await requireParentContext(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    const method = request.method.toUpperCase();
    if (method === "GET") {
      return jsonResponse(
        { reward: await getRewardForParent(dependencies.db, context, rewardId) },
        { status: 200 },
        { private: true },
      );
    }
    if (!["PATCH", "DELETE"].includes(method)) return methodNotAllowed("GET, PATCH, DELETE");
    assertCsrf(request);
    if (method === "DELETE") {
      const reward = await archiveRewardForParent(
        dependencies.db,
        context,
        rewardId,
        { now: dependencies.now },
      );
      return jsonResponse({ reward }, { status: 200 }, { private: true });
    }
    const body = await readBody(request);
    onlyKeys(body, ["title", "emoji", "starCost"]);
    const reward = await updateRewardForParent(
      dependencies.db,
      context,
      rewardId,
      { title: body.title, emoji: body.emoji, starCost: body.starCost },
      { now: dependencies.now },
    );
    return jsonResponse({ reward }, { status: 200 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentActiveReward(
  request: Request,
  dependencies: RewardRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "POST") return methodNotAllowed("POST");
    const context = await requireParentContext(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["profileId", "rewardId"]);
    if (!("profileId" in body) || !("rewardId" in body)) {
      throw new ValidationError("body", "profileId and rewardId are required");
    }
    const reward = await setActiveRewardForParent(
      dependencies.db,
      context,
      body.profileId,
      body.rewardId,
    );
    return jsonResponse({ reward }, { status: 200 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleParentRewardRequests(
  request: Request,
  dependencies: RewardRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParentContext(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    const method = request.method.toUpperCase();
    if (method === "GET") {
      const search = new URL(request.url).searchParams;
      const profileId = search.get("profileId") ?? undefined;
      const includeHistory = search.get("status") === "all";
      return jsonResponse(
        { requests: includeHistory
          ? await listRewardRequestsForParent(dependencies.db, context, profileId)
          : await listPendingRewardRequestsForParent(dependencies.db, context, profileId) },
        { status: 200 },
        { private: true },
      );
    }
    if (method !== "POST") return methodNotAllowed("GET, POST");
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["requestId", "decision", "reason"]);
    if (body.decision !== "approve" && body.decision !== "reject") {
      throw new ValidationError("decision", "decision is invalid");
    }
    const result = await resolveRewardRequestForParent(
      dependencies.db,
      context,
      body.requestId,
      body.decision,
      { now: dependencies.now, reason: body.reason },
    );
    return jsonResponse(result, { status: 200 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleCompanionRewardRequests(
  request: Request,
  dependencies: RewardRouteDependencies,
): Promise<Response> {
  try {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "POST") return methodNotAllowed("GET, POST");
    if (method === "POST") assertSameOrigin(request);
    const context = await requireCompanionContext(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    if (method === "GET") {
      return jsonResponse(
        { requests: await listRewardRequestsForCompanion(dependencies.db, context) },
        { status: 200 },
        { private: true },
      );
    }
    const body = await readBody(request);
    onlyKeys(body, ["rewardId"]);
    const rewardRequest = await createRewardRequestForCompanion(
      dependencies.db,
      context,
      body.rewardId,
      { now: dependencies.now },
    );
    return jsonResponse({ request: rewardRequest }, { status: 201 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
