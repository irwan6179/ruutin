/**
 * Server-only transactional email adapter.
 *
 * The adapter intentionally depends only on Web Platform APIs that are
 * available in a Sites/Cloudflare Worker runtime. It implements the Resend
 * HTTP contract without importing a Node SDK, so the provider credential
 * never crosses into a browser bundle.
 */

export type EmailProviderConfig = Readonly<{
  EMAIL_API_URL: string;
  EMAIL_API_KEY: string;
  EMAIL_FROM: string;
}>;

export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
}>;

export type EmailFailureReason = "configuration" | "timeout" | "network" | "provider";

export type SendEmailOptions = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

export const DEFAULT_EMAIL_TIMEOUT_MS = 8_000;

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A public-safe error type. Its message deliberately contains no provider
 * response, URL, recipient, credential, or message content.
 */
export class EmailAdapterError extends Error {
  readonly reason: EmailFailureReason;

  constructor(reason: EmailFailureReason) {
    super("Email delivery failed");
    this.name = "EmailAdapterError";
    this.reason = reason;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isEmailAddress(value: string): boolean {
  return EMAIL_ADDRESS_PATTERN.test(value);
}

/**
 * Read only the generic email variables needed by this adapter.
 *
 * Probe-only variables are intentionally not part of this loader. They are
 * checked separately by the temporary route and are never needed by future
 * authentication callers.
 */
export function loadEmailConfig(
  source: Record<string, unknown>,
): EmailProviderConfig {
  const apiUrl = source.EMAIL_API_URL;
  const apiKey = source.EMAIL_API_KEY;
  const from = source.EMAIL_FROM;

  if (
    !isNonEmptyString(apiUrl) ||
    !isNonEmptyString(apiKey) ||
    !isNonEmptyString(from) ||
    !isHttpsUrl(apiUrl.trim())
  ) {
    throw new EmailAdapterError("configuration");
  }

  return {
    EMAIL_API_URL: apiUrl.trim(),
    // Preserve the key exactly as configured; whitespace is not silently
    // removed from credentials.
    EMAIL_API_KEY: apiKey,
    EMAIL_FROM: from.trim(),
  };
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  return (error as { name?: unknown }).name === "AbortError";
}

function isValidTimeout(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Send one plain-text email through the configured Resend-compatible HTTPS
 * endpoint. Non-2xx responses and transport failures are intentionally
 * collapsed into a small, public-safe error taxonomy.
 */
export async function sendEmail(
  config: EmailProviderConfig,
  message: EmailMessage,
  options: SendEmailOptions = {},
): Promise<void> {
  if (
    !isHttpsUrl(config.EMAIL_API_URL) ||
    !isNonEmptyString(config.EMAIL_API_KEY) ||
    !isNonEmptyString(config.EMAIL_FROM) ||
    !isNonEmptyString(message.to) ||
    !isEmailAddress(message.to) ||
    !isNonEmptyString(message.subject) ||
    !isNonEmptyString(message.text)
  ) {
    throw new EmailAdapterError("configuration");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS;
  if (!isValidTimeout(timeoutMs)) {
    throw new EmailAdapterError("configuration");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  try {
    const response = await fetchImpl(config.EMAIL_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.EMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      // Resend accepts `to` as either a string or an array. Keep the array
      // form so this adapter can grow to multiple recipients without changing
      // its provider contract.
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      // Do not read or include the provider response body. It can contain
      // provider diagnostics, recipient details, or other sensitive data.
      throw new EmailAdapterError("provider");
    }
  } catch (error) {
    if (error instanceof EmailAdapterError) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new EmailAdapterError("timeout");
    }

    throw new EmailAdapterError("network");
  } finally {
    clearTimeout(timeout);
  }
}
