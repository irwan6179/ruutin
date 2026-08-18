import {
  AuthorizationError,
  getCookie,
  requireParentContext,
  resolveParentSession,
  type D1DatabaseLike,
  type ParentContext,
} from "./auth-context";
import { assertCsrf, CSRF_COOKIE_NAME, issueCsrfToken, jsonResponse } from "./http-security";
import { publicErrorResponse } from "./error-safety";
import {
  createHouseholdForParent,
  householdForSession,
  HouseholdAlreadyExistsError,
} from "./households";
import {
  archiveProfileForParent,
  createProfileForParent,
  getProfileForParent,
  listProfilesForParent,
  updateProfileForParent,
} from "./profiles";
import { countOnboardingRows, getTodayOverview } from "./today";
import { deriveOnboardingState } from "./onboarding";
import { listDevicesForParent, renameDeviceForParent, revokeDeviceForParent } from "./devices";
import {
  cancelPairingChallenge,
  createPairingChallenge,
  getActivePairingChallengeForParent,
} from "./pairing";
import { ValidationError } from "./validation";
import {
  archiveTaskForParent,
  createTaskForParent,
  createTasksForParentBulk,
  getTaskForParent,
  listTaskOccurrencesForParent,
  listTasksForParent,
  reorderTasksForParent,
  updateTaskForParent,
} from "./tasks";

export type ParentRouteDependencies = Readonly<{
  db: D1DatabaseLike;
  sessionSecret: string;
  /** Separate auth HMAC used for pairing/TAC material. Tests may omit it. */
  authHmacSecret?: string;
  now?: Date;
}>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<JsonRecord> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 16 * 1024) throw new ValidationError("body", "request body is too large");
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
  if (Object.keys(body).some((key) => !keys.includes(key))) {
    throw new ValidationError("body", "request body contains unsupported fields");
  }
}

function routeResponseError(error: unknown): Response {
  // Household creation is intentionally a conflict rather than an accidental
  // second household. It still carries no user/household details.
  if (error instanceof HouseholdAlreadyExistsError) {
    return jsonResponse(
      { error: "conflict", message: "This parent already has a household" },
      { status: 409 },
      { private: true },
    );
  }
  return publicErrorResponse(error);
}

function parentRequestError(error: unknown): Response {
  return routeResponseError(error);
}

export function handleParentCsrfBootstrap(request: Request): Response {
  const existing = getCookie(request, CSRF_COOKIE_NAME);
  const result = existing ? { token: existing, cookie: null } : issueCsrfToken();
  const response = jsonResponse({ ok: true, csrfToken: result.token }, { status: 200 }, { private: true });
  if (result.cookie) response.headers.append("Set-Cookie", result.cookie);
  return response;
}

export async function handleParentHousehold(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    const session = await resolveParentSession(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
      now: dependencies.now,
    });
    if (!session) throw new AuthorizationError();
    if (request.method.toUpperCase() === "GET") {
      const household = await householdForSession(dependencies.db, session);
      return jsonResponse({ household }, { status: 200 }, { private: true });
    }
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
    }
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["name", "timezone"]);
    const household = await createHouseholdForParent(dependencies.db, session, { name: body.name, timezone: body.timezone }, { now: dependencies.now });
    return jsonResponse({ household }, { status: 201 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

async function requireParent(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<ParentContext> {
  return requireParentContext(request, dependencies.db, {
    sessionSecret: dependencies.sessionSecret,
    now: dependencies.now,
  });
}

export async function handleParentProfiles(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    const method = request.method.toUpperCase();
    if (method === "GET") {
      return jsonResponse({ profiles: await listProfilesForParent(dependencies.db, context) }, { status: 200 }, { private: true });
    }
    if (method !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["nickname", "emoji", "ageBand", "consentConfirmed"]);
    const profile = await createProfileForParent(dependencies.db, context, {
      nickname: body.nickname,
      emoji: body.emoji,
      ageBand: body.ageBand,
      consentConfirmed: body.consentConfirmed,
    }, { now: dependencies.now });
    return jsonResponse({ profile }, { status: 201 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentProfile(
  request: Request,
  dependencies: ParentRouteDependencies,
  profileId: string,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    const method = request.method.toUpperCase();
    if (method === "GET") {
      return jsonResponse({ profile: await getProfileForParent(dependencies.db, context, profileId) }, { status: 200 }, { private: true });
    }
    if (!["PATCH", "DELETE"].includes(method)) return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, PATCH, DELETE" } });
    assertCsrf(request);
    if (method === "DELETE") {
      const profile = await archiveProfileForParent(dependencies.db, context, profileId, { now: dependencies.now });
      return jsonResponse({ profile }, { status: 200 }, { private: true });
    }
    const body = await readBody(request);
    onlyKeys(body, ["nickname", "emoji", "ageBand", "consentConfirmed", "archived"]);
    const profile = await updateProfileForParent(dependencies.db, context, profileId, body, { now: dependencies.now });
    return jsonResponse({ profile }, { status: 200 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentOnboarding(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "GET") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } });
    const session = await resolveParentSession(request, dependencies.db, { sessionSecret: dependencies.sessionSecret, now: dependencies.now });
    if (!session) throw new AuthorizationError();
    const household = await householdForSession(dependencies.db, session);
    if (!household) {
      return jsonResponse({ household: null, state: deriveOnboardingState({ hasHousehold: false, profileCount: 0, taskCount: 0, rewardCount: 0 }) }, { status: 200 }, { private: true });
    }
    const context = await requireParent(request, dependencies);
    const [profiles, rows] = await Promise.all([
      listProfilesForParent(dependencies.db, context),
      countOnboardingRows(dependencies.db, context),
    ]);
    const state = deriveOnboardingState({ hasHousehold: true, profileCount: profiles.length, ...rows });
    return jsonResponse({ household, state }, { status: 200 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentToday(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "GET") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } });
    const context = await requireParent(request, dependencies);
    return jsonResponse({ overview: await getTodayOverview(dependencies.db, context, { now: dependencies.now }) }, { status: 200 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentDevices(
  request: Request,
  dependencies: ParentRouteDependencies,
  deviceId?: string,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    const method = request.method.toUpperCase();
    if (method === "GET") return jsonResponse({ devices: await listDevicesForParent(dependencies.db, context) }, { status: 200 }, { private: true });
    if (!deviceId || !["PATCH", "DELETE"].includes(method)) return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, PATCH, DELETE" } });
    assertCsrf(request);
    if (method === "DELETE") {
      await revokeDeviceForParent(dependencies.db, context, deviceId, { now: dependencies.now });
    } else {
      const body = await readBody(request);
      onlyKeys(body, ["deviceLabel"]);
      await renameDeviceForParent(dependencies.db, context, deviceId, body.deviceLabel);
    }
    return jsonResponse({ ok: true }, { status: 200 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

function pairingSecret(dependencies: ParentRouteDependencies): string {
  // Production always supplies AUTH_HMAC_SECRET.  Falling back to the session
  // secret keeps framework-free route tests useful without weakening the
  // deployed configuration boundary (parentRouteDependencies supplies both).
  return dependencies.authHmacSecret ?? dependencies.sessionSecret;
}

export async function handleParentPairing(
  request: Request,
  dependencies: ParentRouteDependencies,
  challengeId?: string,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    const method = request.method.toUpperCase();
    if (method === "GET") {
      const profileId = new URL(request.url).searchParams.get("profileId");
      if (!profileId) throw new ValidationError("profileId", "profileId is required");
      const challenge = await getActivePairingChallengeForParent(
        dependencies.db,
        context,
        profileId,
        { now: dependencies.now },
      );
      return jsonResponse({ challenge }, { status: 200 }, { private: true });
    }
    if (method === "POST") {
      assertCsrf(request);
      const body = await readBody(request);
      onlyKeys(body, ["profileId"]);
      const challenge = await createPairingChallenge(
        dependencies.db,
        context,
        body.profileId,
        pairingSecret(dependencies),
        { now: dependencies.now },
      );
      const origin = new URL(request.url).origin;
      return jsonResponse(
        {
          challenge: {
            id: challenge.id,
            profileId: challenge.profileId,
            code: challenge.code,
            token: challenge.pairingToken,
            pairingUrl: `${origin}/pair?token=${encodeURIComponent(challenge.pairingToken)}`,
            expiresAt: challenge.expiresAt,
          },
        },
        { status: 201 },
        { private: true },
      );
    }
    if (method === "DELETE") {
      assertCsrf(request);
      if (!challengeId) throw new ValidationError("challengeId", "challengeId is required");
      await cancelPairingChallenge(dependencies.db, context, challengeId, { now: dependencies.now });
      return jsonResponse({ ok: true }, { status: 200 }, { private: true });
    }
    return jsonResponse(
      { error: "method_not_allowed", message: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST, DELETE" } },
    );
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentTasks(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    const method = request.method.toUpperCase();
    if (method === "GET") {
      const url = new URL(request.url);
      const profileId = url.searchParams.get("profileId");
      if (!profileId) throw new ValidationError("profileId", "profileId is required");
      if (url.searchParams.get("view") === "management") {
        const [tasks, occurrenceView] = await Promise.all([
          listTasksForParent(dependencies.db, context, profileId),
          listTaskOccurrencesForParent(dependencies.db, context, profileId, { now: dependencies.now }),
        ]);
        const byId = new Map(occurrenceView.occurrences.map((occurrence) => [occurrence.id, occurrence]));
        const managementTasks = tasks.map((task) => byId.get(task.id) ?? {
          ...task,
          dueDate: occurrenceView.localDate,
          // Management lists all active tasks so parents can edit/reorder
          // future schedules too. A future task is not a due occurrence and
          // must not be presented as an actionable "To do" item today.
          state: "not_due" as const,
          claimId: null,
          submittedAt: null,
        });
        return jsonResponse({ tasks: managementTasks, occurrences: occurrenceView.occurrences, localDate: occurrenceView.localDate }, { status: 200 }, { private: true });
      }
      const view = await listTaskOccurrencesForParent(dependencies.db, context, profileId, {
        now: dependencies.now,
        localDate: url.searchParams.get("localDate") ?? undefined,
      });
      return jsonResponse({ tasks: view.occurrences, occurrences: view.occurrences, localDate: view.localDate }, { status: 200 }, { private: true });
    }
    if (method !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["profileId", "title", "emoji", "stars", "schedule"]);
    const task = await createTaskForParent(dependencies.db, context, {
      profileId: body.profileId,
      title: body.title,
      emoji: body.emoji,
      stars: body.stars,
      schedule: body.schedule,
    }, { now: dependencies.now });
    return jsonResponse({ task }, { status: 201 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentTask(
  request: Request,
  dependencies: ParentRouteDependencies,
  taskId: string,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    const method = request.method.toUpperCase();
    if (method === "GET") {
      return jsonResponse({ task: await getTaskForParent(dependencies.db, context, taskId) }, { status: 200 }, { private: true });
    }
    if (!["PATCH", "DELETE"].includes(method)) return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "GET, PATCH, DELETE" } });
    assertCsrf(request);
    if (method === "DELETE") {
      return jsonResponse({ task: await archiveTaskForParent(dependencies.db, context, taskId, { now: dependencies.now }) }, { status: 200 }, { private: true });
    }
    const body = await readBody(request);
    onlyKeys(body, ["title", "emoji", "stars", "schedule", "archived"]);
    return jsonResponse({ task: await updateTaskForParent(dependencies.db, context, taskId, body, { now: dependencies.now }) }, { status: 200 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentTaskReorder(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    if (request.method.toUpperCase() !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["profileId", "taskIds"]);
    const tasks = await reorderTasksForParent(dependencies.db, context, body.profileId, body.taskIds);
    return jsonResponse({ tasks }, { status: 200 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}

export async function handleParentTaskBulk(
  request: Request,
  dependencies: ParentRouteDependencies,
): Promise<Response> {
  try {
    const context = await requireParent(request, dependencies);
    if (request.method.toUpperCase() !== "POST") return jsonResponse({ error: "method_not_allowed", message: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
    assertCsrf(request);
    const body = await readBody(request);
    onlyKeys(body, ["profileId", "drafts"]);
    const tasks = await createTasksForParentBulk(dependencies.db, context, body.profileId, body.drafts, { now: dependencies.now });
    return jsonResponse({ tasks }, { status: 201 }, { private: true });
  } catch (error) {
    return parentRequestError(error);
  }
}
