/**
 * Pure guards for the temporary BR-002 email reachability probe.
 *
 * Keeping these helpers free of framework imports makes the fail-closed
 * behavior easy to test without creating a Worker runtime.
 */

export type EmailProbeConfig = Readonly<{
  EMAIL_PROBE_TO: string;
  RUNTIME_PROBE_SECRET: string;
}>;

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Return probe configuration only when both temporary server-only variables
 * are present and the destination is a single plausible email address.
 */
export function readEmailProbeConfig(
  source: Record<string, unknown>,
): EmailProbeConfig | null {
  const recipient = source.EMAIL_PROBE_TO;
  const secret = source.RUNTIME_PROBE_SECRET;

  if (
    !isNonEmptyString(recipient) ||
    !EMAIL_ADDRESS_PATTERN.test(recipient.trim()) ||
    !isNonEmptyString(secret)
  ) {
    return null;
  }

  return {
    EMAIL_PROBE_TO: recipient.trim(),
    RUNTIME_PROBE_SECRET: secret.trim(),
  };
}

/**
 * Match an exact HTTP Bearer credential without accepting extra token text.
 * The route never logs this value or includes it in a response.
 */
export function hasBearerProbeSecret(
  request: Request,
  expectedSecret: string,
): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;

  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
  if (!match) return false;

  const received = new TextEncoder().encode(match[1].trim());
  const expected = new TextEncoder().encode(expectedSecret);
  const length = Math.max(received.length, expected.length);
  let difference = received.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (received[index] ?? 0) ^ (expected[index] ?? 0);
  }

  return difference === 0;
}
