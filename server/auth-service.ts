import {
  DeterministicEmailAdapter,
  type EmailMessage,
  type EmailSender,
} from "./email-adapter";
import {
  consumeRateLimit,
  emailRateLimitKey,
  rateLimitKey,
  sourceRateLimitKey,
  RateLimitError,
  type RateLimitPolicy,
  type RateLimitStore,
} from "./rate-limit";
import { createTacChallenge, TacDeliveryError, type TacChallenge } from "./tac";
import { normalizeEmail } from "./validation";

/** Request policy is intentionally conservative for a public sign-in form. */
export const TAC_EMAIL_POLICY: RateLimitPolicy = Object.freeze({
  limit: 5,
  windowMs: 60 * 60 * 1000,
});
export const TAC_EMAIL_SOURCE_POLICY: RateLimitPolicy = Object.freeze({
  limit: 3,
  windowMs: 15 * 60 * 1000,
});
export const TAC_SOURCE_POLICY: RateLimitPolicy = Object.freeze({
  limit: 20,
  windowMs: 15 * 60 * 1000,
});

export const TAC_REQUEST_MESSAGE =
  "If that email can receive Ruutin sign-in mail, a six-digit code is on its way.";

export type TacRequestResult = Readonly<{
  challenge: TacChallenge;
  emailNormalized: string;
}>;

export type TacRequestOptions = Readonly<{
  now?: Date;
  emailPolicy?: RateLimitPolicy;
  emailSourcePolicy?: RateLimitPolicy;
  sourcePolicy?: RateLimitPolicy;
  challengeCode?: string;
}>;

export type TacRequestDependencies = Readonly<{
  db: import("./auth-context").D1DatabaseLike;
  authHmacSecret: string;
  rateLimitStore: RateLimitStore;
  emailSender: EmailSender;
}>;

/** Keep provider copy parent-appropriate and avoid putting the email in logs. */
export function buildTacEmail(code: string, to = ""): EmailMessage {
  return {
    to,
    subject: "Your Ruutin sign-in code",
    text: [
      "Your Ruutin sign-in code is:",
      "",
      code,
      "",
      "It expires in 10 minutes and can only be used once.",
      "If you did not request this, you can safely ignore this email.",
    ].join("\n"),
  };
}

/** Resolve a stable edge-provided source without trusting browser body fields. */
export function requestSourceFromHeaders(headers: Headers): string {
  const connected = headers.get("cf-connecting-ip")?.trim();
  if (connected) return connected.slice(0, 128);
  // Do not fall back to X-Forwarded-For: a direct client can supply it. Sites
  // runs on Cloudflare, so absence of the edge-owned header collapses into one
  // conservative bucket rather than trusting browser-controlled input.
  return "unknown";
}

export const getRequestSource = requestSourceFromHeaders;

/**
 * Enforce all TAC request buckets. We intentionally consume the email bucket
 * before the source bucket; a blocked source therefore cannot repeatedly probe
 * many identities without also exhausting each identity's allowance.
 */
export async function enforceTacRequestLimits(
  dependencies: Pick<TacRequestDependencies, "rateLimitStore">,
  emailNormalized: string,
  requestSource: string,
  options: {
    now?: Date;
    emailPolicy?: RateLimitPolicy;
    emailSourcePolicy?: RateLimitPolicy;
    sourcePolicy?: RateLimitPolicy;
    namespace?: string;
  } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const emailPolicy = options.emailPolicy ?? TAC_EMAIL_POLICY;
  const emailSourcePolicy = options.emailSourcePolicy ?? TAC_EMAIL_SOURCE_POLICY;
  const sourcePolicy = options.sourcePolicy ?? TAC_SOURCE_POLICY;
  const namespace = options.namespace?.trim();
  const identityKey = namespace
    ? rateLimitKey(`${namespace}-email-tac-identity`, emailNormalized)
    : rateLimitKey("email-tac-identity", emailNormalized);
  const emailSourceKey = namespace
    ? rateLimitKey(`${namespace}-email-tac`, emailNormalized, requestSource)
    : emailRateLimitKey(emailNormalized, requestSource);
  const sourceKey = namespace
    ? rateLimitKey(`${namespace}-source-tac`, requestSource)
    : sourceRateLimitKey(requestSource);
  const decisions = await Promise.all([
    consumeRateLimit(
      dependencies.rateLimitStore,
      identityKey,
      emailPolicy,
      { now },
    ),
    consumeRateLimit(
      dependencies.rateLimitStore,
      emailSourceKey,
      emailSourcePolicy,
      { now },
    ),
    consumeRateLimit(
      dependencies.rateLimitStore,
      sourceKey,
      sourcePolicy,
      { now },
    ),
  ]);
  const blocked = decisions.find((decision) => !decision.allowed);
  if (blocked) {
    throw new RateLimitError(blocked.retryAfterSeconds);
  }
}

export async function requestParentTac(
  dependencies: TacRequestDependencies,
  email: unknown,
  requestSource: string,
  options: TacRequestOptions = {},
): Promise<TacRequestResult> {
  const emailNormalized = normalizeEmail(email);
  await enforceTacRequestLimits(dependencies, emailNormalized, requestSource, {
    now: options.now,
    emailPolicy: options.emailPolicy,
    emailSourcePolicy: options.emailSourcePolicy,
    sourcePolicy: options.sourcePolicy,
  });

  const challenge = await createTacChallenge(dependencies.db, emailNormalized, dependencies.authHmacSecret, {
    now: options.now,
    code: options.challengeCode,
  });
  const message = buildTacEmail(challenge.code);
  await dependencies.emailSender.send({
    ...message,
    to: emailNormalized,
  }).catch(() => {
    throw new TacDeliveryError();
  });
  return { challenge, emailNormalized };
}

/** Exported factory for tests that need a no-network sender in one line. */
export function createDeterministicTestEmailAdapter(
  options: { failure?: "configuration" | "timeout" | "network" | "provider" } = {},
): DeterministicEmailAdapter {
  return new DeterministicEmailAdapter(options);
}
