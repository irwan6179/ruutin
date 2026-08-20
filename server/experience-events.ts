import {
  getCookie,
  requireCompanionContext,
  requireParentContext,
  type CompanionContext,
  type D1DatabaseLike,
  type ParentContext,
} from "./auth-context";
import { publicErrorResponse } from "./error-safety";
import {
  assertCsrf,
  CSRF_COOKIE_NAME,
  issueCsrfToken,
  jsonResponse,
} from "./http-security";
import { ScopeError } from "./scoped-data";
import {
  createId,
  localDateFor,
  toUtcTimestamp,
  ValidationError,
} from "./validation";

export const EXPERIENCE_EVENT_NAMES = [
  "parent_today_opened",
  "companion_today_opened",
  "onboarding_completed",
  "reward_goal_selected",
  "install_guidance_opened",
] as const;

export type ExperienceEventName = (typeof EXPERIENCE_EVENT_NAMES)[number];
export type ExperienceContext = ParentContext | CompanionContext;

type ExperienceSubject = {
  type: "reward";
  id: string;
};

export type ExperienceEventRecord = {
  id: string;
  householdId: string;
  actorKind: "parent" | "companion";
  actorKey: string;
  eventName: ExperienceEventName;
  subjectType: ExperienceSubject["type"] | null;
  subjectId: string | null;
  localDate: string;
  createdAt: string;
};

export type ExperienceEventDependencies = {
  db: D1DatabaseLike;
  sessionSecret: string;
  now?: Date;
};

const CLIENT_EVENT_NAMES = new Set<ExperienceEventName>([
  "parent_today_opened",
  "companion_today_opened",
  "onboarding_completed",
  "install_guidance_opened",
]);

function isExperienceEventName(value: unknown): value is ExperienceEventName {
  return (
    typeof value === "string" &&
    (EXPERIENCE_EVENT_NAMES as readonly string[]).includes(value)
  );
}

function eventName(value: unknown): ExperienceEventName {
  if (
    typeof value !== "string" ||
    !CLIENT_EVENT_NAMES.has(value as ExperienceEventName)
  ) {
    throw new ValidationError("eventName", "event is not supported");
  }
  return value as ExperienceEventName;
}

function safeOpaqueId(value: string, field: string, maxLength = 128): string {
  if (
    value.length < 1 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
    )
  ) {
    throw new ValidationError(field, `${field} is invalid`);
  }
  return value;
}

async function assertActorScope(
  db: D1DatabaseLike,
  context: ExperienceContext,
  createdAt: string,
): Promise<void> {
  const row = context.kind === "parent"
    ? await db
        .prepare(
          `SELECT 1 AS present
           FROM household_users
           WHERE household_id = ? AND user_id = ?
             AND role IN ('parent', 'caregiver')
           LIMIT 1`,
        )
        .bind(context.householdId, context.userId)
        .first<{ present: number }>()
    : await db
        .prepare(
          `SELECT 1 AS present
           FROM child_devices AS d
           INNER JOIN child_profiles AS p
             ON p.household_id = d.household_id
            AND p.id = d.child_profile_id
           WHERE d.id = ? AND d.household_id = ?
             AND d.child_profile_id = ?
             AND d.revoked_at IS NULL
             AND (d.expires_at IS NULL OR d.expires_at > ?)
             AND p.archived_at IS NULL
             AND p.companion_access_eligible = 1
             AND (p.age_band IS NULL OR p.age_band <> 'under_13')
           LIMIT 1`,
        )
        .bind(
          context.deviceId,
          context.householdId,
          context.profileId,
          createdAt,
        )
        .first<{ present: number }>();
  if (!row) throw new ScopeError();
}

async function assertSubjectScope(
  db: D1DatabaseLike,
  context: ExperienceContext,
  name: ExperienceEventName,
  subject: ExperienceSubject | null,
): Promise<ExperienceSubject | null> {
  if (name !== "reward_goal_selected") {
    if (subject) throw new ValidationError("subject", "subject is not supported");
    return null;
  }
  if (!subject) {
    throw new ValidationError("subject", "reward subject is required");
  }
  const subjectId = safeOpaqueId(subject.id, "subjectId");
  const reward = await db
    .prepare(
      `SELECT child_profile_id AS profileId
       FROM rewards
       WHERE household_id = ? AND id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .bind(context.householdId, subjectId)
    .first<{ profileId: string }>();
  if (!reward) throw new ScopeError();
  if (context.kind === "companion" && reward.profileId !== context.profileId) {
    throw new ScopeError();
  }
  return { type: "reward", id: subjectId };
}

async function householdLocalDate(
  db: D1DatabaseLike,
  householdId: string,
  now: Date,
): Promise<string> {
  const row = await db
    .prepare("SELECT timezone FROM households WHERE id = ? LIMIT 1")
    .bind(householdId)
    .first<{ timezone: string }>();
  if (!row) throw new Error("Experience scope is unavailable");
  return localDateFor(now, row.timezone);
}

function actor(context: ExperienceContext): {
  householdId: string;
  actorKind: "parent" | "companion";
  actorKey: string;
} {
  return context.kind === "parent"
    ? {
        householdId: context.householdId,
        actorKind: "parent",
        actorKey: context.userId,
      }
    : {
        householdId: context.householdId,
        actorKind: "companion",
        actorKey: context.deviceId,
      };
}

function assertEventActor(
  name: ExperienceEventName,
  context: ExperienceContext,
): void {
  const parentEvent =
    name === "parent_today_opened" ||
    name === "onboarding_completed" ||
    name === "reward_goal_selected";
  if (
    (parentEvent && context.kind !== "parent") ||
    (!parentEvent && context.kind !== "companion")
  ) {
    throw new ValidationError("eventName", "event is not supported");
  }
}

export async function recordExperienceEvent(
  db: D1DatabaseLike,
  context: ExperienceContext,
  name: ExperienceEventName,
  options: {
    now?: Date;
    subject?: ExperienceSubject;
  } = {},
): Promise<ExperienceEventRecord> {
  if (!isExperienceEventName(name)) {
    throw new ValidationError("eventName", "event is not supported");
  }
  assertEventActor(name, context);
  const nowDate = options.now ?? new Date();
  const createdAt = toUtcTimestamp(nowDate);
  const identity = actor(context);
  safeOpaqueId(identity.householdId, "householdId");
  safeOpaqueId(identity.actorKey, "actorKey");
  await assertActorScope(db, context, createdAt);
  const localDate = await householdLocalDate(
    db,
    identity.householdId,
    nowDate,
  );
  const subject = await assertSubjectScope(
    db,
    context,
    name,
    options.subject ?? null,
  );
  // One event per allow-listed signal, actor, and household-local day. This
  // is derived only on the server; a client cannot manufacture a second event
  // by supplying a custom scope or payload.
  const dedupeKey = `${name}:${identity.actorKind}:${identity.actorKey}:${localDate}`;
  const id = createId();
  try {
    const insertion = db
      .prepare(
        `INSERT INTO experience_events
          (id, household_id, actor_kind, actor_key, event_name,
           subject_type, subject_id, local_date, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        identity.householdId,
        identity.actorKind,
        safeOpaqueId(identity.actorKey, "actorKey"),
        name,
        subject?.type ?? null,
        subject?.id ?? null,
        localDate,
        dedupeKey,
        createdAt,
      );
    if (!insertion.run) throw new Error("D1 write capability is unavailable");
    await insertion.run();
  } catch {
    const existing = await db
      .prepare(
        `SELECT id, household_id AS householdId, actor_kind AS actorKind,
                actor_key AS actorKey, event_name AS eventName,
                subject_type AS subjectType, subject_id AS subjectId,
                local_date AS localDate, created_at AS createdAt
         FROM experience_events
         WHERE household_id = ? AND dedupe_key = ? LIMIT 1`,
      )
      .bind(identity.householdId, dedupeKey)
      .first<ExperienceEventRecord>();
    if (existing) return existing;
    throw new Error("Experience signal could not be recorded");
  }
  return {
    id,
    householdId: identity.householdId,
    actorKind: identity.actorKind,
    actorKey: identity.actorKey,
    eventName: name,
    subjectType: subject?.type ?? null,
    subjectId: subject?.id ?? null,
    localDate,
    createdAt,
  };
}

function bootstrapResponse(request: Request): Response {
  const existing = getCookie(request, CSRF_COOKIE_NAME);
  const csrf = existing ? { token: existing, cookie: null } : issueCsrfToken();
  const response = jsonResponse(
    { csrfToken: csrf.token },
    { status: 200 },
    { private: true },
  );
  if (csrf.cookie) response.headers.append("Set-Cookie", csrf.cookie);
  return response;
}

async function readBody(request: Request): Promise<{ eventName: unknown }> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 1024) {
    throw new ValidationError("body", "request body is too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ValidationError("body", "request body is invalid");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("body", "request body is invalid");
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "eventName")) {
    throw new ValidationError("body", "request body contains unsupported fields");
  }
  return { eventName: record.eventName };
}

export async function handleExperienceEvent(
  request: Request,
  dependencies: ExperienceEventDependencies,
): Promise<Response> {
  if (request.method.toUpperCase() === "GET") return bootstrapResponse(request);
  try {
    assertCsrf(request);
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "GET, POST" } },
      );
    }
    const body = await readBody(request);
    const name = eventName(body.eventName);
    const context =
      name === "companion_today_opened" || name === "install_guidance_opened"
        ? await requireCompanionContext(request, dependencies.db, {
            sessionSecret: dependencies.sessionSecret,
            now: dependencies.now,
          })
        : await requireParentContext(request, dependencies.db, {
            sessionSecret: dependencies.sessionSecret,
            now: dependencies.now,
          });
    await recordExperienceEvent(dependencies.db, context, name, {
      now: dependencies.now,
    });
    return jsonResponse({ ok: true }, { status: 202 }, { private: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
}
