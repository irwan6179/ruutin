import {
  hashOpaqueToken,
  PARENT_SESSION_COOKIE,
  serializeSessionCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  type D1DatabaseLike,
  type D1StatementLike,
} from "./auth-context";
import { publicErrorResponse } from "./error-safety";
import { assertCsrf, issueCsrfToken, jsonResponse } from "./http-security";
import { createSessionToken } from "./tac";
import { createId, localDateFor, toUtcTimestamp } from "./validation";

const DEMO_EMAIL = "demo.parent@ruutin.local";
const DEMO_USER_ID = "dev-demo-parent";
const DEMO_HOUSEHOLD_ID = "dev-demo-household";
const DEMO_PROFILE_ID = "dev-demo-profile-ari";
const DEMO_SECOND_PROFILE_ID = "dev-demo-profile-mina";
const DEMO_DEVICE_ID = "dev-demo-device-ari";
const DEMO_REWARD_ID = "dev-demo-reward-ari";
const DEMO_SECOND_REWARD_ID = "dev-demo-reward-mina";
const DEMO_TIMEZONE = "Asia/Kuala_Lumpur";

type DevelopmentLoginDependencies = Readonly<{
  db: D1DatabaseLike;
  sessionSecret: string;
  enabled: boolean;
  allowedHostnames?: readonly string[];
  now?: Date;
}>;

type DemoSession = Readonly<{
  sessionToken: string;
}>;

function loopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}

export function isAllowedDevelopmentRequest(
  request: Request,
  allowedHostnames: readonly string[] = [],
): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return (
      loopbackHostname(hostname) ||
      allowedHostnames.some((allowed) => allowed.trim().toLowerCase() === hostname)
    );
  } catch {
    return false;
  }
}

function unavailableResponse(): Response {
  return jsonResponse(
    { error: "not_found", message: "Not found" },
    { status: 404 },
    { private: true },
  );
}

function runStatement(statement: D1StatementLike): Promise<unknown> {
  if (!statement.run) throw new Error("D1 write capability is unavailable");
  return statement.run();
}

async function runStatements(
  db: D1DatabaseLike,
  statements: readonly D1StatementLike[],
): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await runStatement(statement);
}

async function seedDemoSession(
  dependencies: Pick<DevelopmentLoginDependencies, "db" | "sessionSecret" | "now">,
): Promise<DemoSession> {
  const { db, sessionSecret } = dependencies;
  const nowDate = dependencies.now ?? new Date();
  const now = toUtcTimestamp(nowDate);
  const localDate = localDateFor(nowDate, DEMO_TIMEZONE);
  const expiresAt = toUtcTimestamp(
    new Date(nowDate.getTime() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000),
  );
  const sessionToken = createSessionToken();
  const sessionTokenHash = await hashOpaqueToken(sessionToken, sessionSecret);
  const sessionId = createId();

  await runStatement(
    db
      .prepare(
        `INSERT INTO users (id, email, email_normalized, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(email_normalized) DO UPDATE SET last_login_at = excluded.last_login_at`,
      )
      .bind(DEMO_USER_ID, DEMO_EMAIL, DEMO_EMAIL, now, now),
  );
  const user = await db
    .prepare("SELECT id FROM users WHERE email_normalized = ? LIMIT 1")
    .bind(DEMO_EMAIL)
    .first<{ id: string }>();
  if (!user?.id) throw new Error("Demo parent could not be prepared");

  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO households (id, name, timezone, created_at)
         VALUES (?, 'The Demo Home', ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_TIMEZONE, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO household_users
           (household_id, user_id, role, created_at)
         VALUES (?, ?, 'parent', ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, user.id, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO child_profiles
           (id, household_id, nickname, emoji, age_band,
            companion_access_eligible, active_reward_id, archived_at, created_at)
         VALUES (?, ?, 'Ari', '🌿', '13_15', 1, NULL, NULL, ?)`,
      )
      .bind(DEMO_PROFILE_ID, DEMO_HOUSEHOLD_ID, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO child_profiles
           (id, household_id, nickname, emoji, age_band,
            companion_access_eligible, active_reward_id, archived_at, created_at)
         VALUES (?, ?, 'Mina', '🌸', 'under_13', 0, NULL, NULL, ?)`,
      )
      .bind(DEMO_SECOND_PROFILE_ID, DEMO_HOUSEHOLD_ID, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (id, household_id, child_profile_id, title, emoji, stars,
            schedule_type, schedule_data, position, archived_at, created_at, updated_at)
         VALUES ('dev-demo-task-bed', ?, ?, 'Make the bed', '🛏️', 1,
                 'daily', '{"type":"daily"}', 0, NULL, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_PROFILE_ID, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (id, household_id, child_profile_id, title, emoji, stars,
            schedule_type, schedule_data, position, archived_at, created_at, updated_at)
         VALUES ('dev-demo-task-pack', ?, ?, 'Pack the school bag', '🎒', 2,
                 'daily', '{"type":"daily"}', 1, NULL, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_PROFILE_ID, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (id, household_id, child_profile_id, title, emoji, stars,
            schedule_type, schedule_data, position, archived_at, created_at, updated_at)
         VALUES ('dev-demo-task-dishes', ?, ?, 'Help with the dishes', '🍽️', 2,
                 'daily', '{"type":"daily"}', 2, NULL, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_PROFILE_ID, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (id, household_id, child_profile_id, title, emoji, stars,
            schedule_type, schedule_data, position, archived_at, created_at, updated_at)
         VALUES ('dev-demo-task-teeth', ?, ?, 'Brush teeth', '🪥', 1,
                 'daily', '{"type":"daily"}', 0, NULL, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_SECOND_PROFILE_ID, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (id, household_id, child_profile_id, title, emoji, stars,
            schedule_type, schedule_data, position, archived_at, created_at, updated_at)
         VALUES ('dev-demo-task-toys', ?, ?, 'Put away toys', '🧸', 1,
                 'daily', '{"type":"daily"}', 1, NULL, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_SECOND_PROFILE_ID, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO rewards
           (id, household_id, child_profile_id, title, emoji, star_cost,
            archived_at, created_at, updated_at)
         VALUES (?, ?, ?, 'Choose family movie', '🎬', 12, NULL, ?, ?)`,
      )
      .bind(DEMO_REWARD_ID, DEMO_HOUSEHOLD_ID, DEMO_PROFILE_ID, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO rewards
           (id, household_id, child_profile_id, title, emoji, star_cost,
            archived_at, created_at, updated_at)
         VALUES (?, ?, ?, 'Bake something together', '🧁', 10, NULL, ?, ?)`,
      )
      .bind(DEMO_SECOND_REWARD_ID, DEMO_HOUSEHOLD_ID, DEMO_SECOND_PROFILE_ID, now, now),
    db
      .prepare(
        `UPDATE child_profiles SET active_reward_id = ?
         WHERE id = ? AND household_id = ? AND archived_at IS NULL`,
      )
      .bind(DEMO_REWARD_ID, DEMO_PROFILE_ID, DEMO_HOUSEHOLD_ID),
    db
      .prepare(
        `UPDATE child_profiles SET active_reward_id = ?
         WHERE id = ? AND household_id = ? AND archived_at IS NULL`,
      )
      .bind(DEMO_SECOND_REWARD_ID, DEMO_SECOND_PROFILE_ID, DEMO_HOUSEHOLD_ID),
    db
      .prepare(
        `INSERT OR IGNORE INTO point_ledger
           (id, household_id, child_profile_id, event_type, stars_delta,
            source_type, source_id, reason, actor_user_id, local_date, created_at)
         VALUES ('dev-demo-ledger-ari', ?, ?, 'manual_adjustment', 8,
                 'manual_adjustment', 'dev-demo-balance-ari',
                 'Demo starting balance', ?, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_PROFILE_ID, user.id, localDate, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO point_ledger
           (id, household_id, child_profile_id, event_type, stars_delta,
            source_type, source_id, reason, actor_user_id, local_date, created_at)
         VALUES ('dev-demo-ledger-mina', ?, ?, 'manual_adjustment', 6,
                 'manual_adjustment', 'dev-demo-balance-mina',
                 'Demo starting balance', ?, ?, ?)`,
      )
      .bind(DEMO_HOUSEHOLD_ID, DEMO_SECOND_PROFILE_ID, user.id, localDate, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO child_devices
           (id, household_id, child_profile_id, device_label, token_hash,
            expires_at, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, 'Ari demo tablet', 'dev-demo-device-token-hash',
                 ?, ?, ?, NULL)`,
      )
      .bind(DEMO_DEVICE_ID, DEMO_HOUSEHOLD_ID, DEMO_PROFILE_ID, expiresAt, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO task_claims
           (id, household_id, child_profile_id, task_id, due_date,
            submitted_by_type, submitted_by_device_id, status, submitted_at,
            resolved_at, resolved_by_user_id)
         VALUES (?, ?, ?, 'dev-demo-task-pack', ?, 'companion', ?, 'pending', ?, NULL, NULL)`,
      )
      .bind(
        `dev-demo-claim-${localDate}`,
        DEMO_HOUSEHOLD_ID,
        DEMO_PROFILE_ID,
        localDate,
        DEMO_DEVICE_ID,
        now,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO reward_requests
           (id, household_id, child_profile_id, reward_id, status,
            requested_by_device_id, requested_at, resolved_at, resolved_by_user_id)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
      )
      .bind(
        `dev-demo-reward-request-${localDate}`,
        DEMO_HOUSEHOLD_ID,
        DEMO_PROFILE_ID,
        DEMO_REWARD_ID,
        DEMO_DEVICE_ID,
        now,
      ),
    db
      .prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, user.id),
    db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(sessionId, user.id, sessionTokenHash, expiresAt, now, now),
  ];

  await runStatements(db, statements);
  return { sessionToken };
}

export async function handleDevelopmentLogin(
  request: Request,
  dependencies: DevelopmentLoginDependencies,
): Promise<Response> {
  if (
    !dependencies.enabled ||
    !isAllowedDevelopmentRequest(request, dependencies.allowedHostnames)
  ) {
    return unavailableResponse();
  }

  if (request.method.toUpperCase() === "GET") {
    const csrf = issueCsrfToken();
    const response = jsonResponse(
      { ok: true, available: true, csrfToken: csrf.token },
      { status: 200 },
      { private: true },
    );
    response.headers.append("Set-Cookie", csrf.cookie);
    return response;
  }

  try {
    if (request.method.toUpperCase() !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "Method not allowed" },
        { status: 405, headers: { Allow: "GET, POST" } },
      );
    }
    assertCsrf(request);
    const session = await seedDemoSession(dependencies);
    const response = jsonResponse(
      { ok: true, redirectTo: "/app/today" },
      { status: 200 },
      { private: true },
    );
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(PARENT_SESSION_COOKIE, session.sessionToken),
    );
    return response;
  } catch (error) {
    return publicErrorResponse(error);
  }
}
