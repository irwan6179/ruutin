/**
 * Server-only configuration validation.
 *
 * This module is intentionally free of framework imports so its validation
 * rules can be tested without creating a Worker runtime. The Worker adapter
 * lives in `server/config.ts`; browser code must never import either module.
 */

export const SERVER_CONFIG_KEYS = [
  "EMAIL_API_URL",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "AUTH_HMAC_SECRET",
  "SESSION_SECRET",
] as const;

type ServerConfigKey = (typeof SERVER_CONFIG_KEYS)[number];

export type ServerConfig = {
  readonly EMAIL_API_URL: string;
  readonly EMAIL_API_KEY: string;
  readonly EMAIL_FROM: string;
  readonly AUTH_HMAC_SECRET: string;
  readonly SESSION_SECRET: string;
};

type RuntimeSource = Partial<Record<ServerConfigKey, unknown>>;

export class ServerConfigError extends Error {
  readonly missing: readonly ServerConfigKey[];

  constructor(missing: readonly ServerConfigKey[]) {
    super(`Missing required server configuration: ${missing.join(", ")}`);
    this.name = "ServerConfigError";
    this.missing = missing;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Validate the complete server configuration.
 *
 * Development can intentionally render the public landing page without
 * credentials. Any production caller must pass `strict: true`, which fails
 * closed before an auth or email operation can run.
 */
export function loadServerConfig(
  source: RuntimeSource,
  options: { strict?: boolean } = {},
): ServerConfig | null {
  const strict = options.strict ?? false;
  const missing = SERVER_CONFIG_KEYS.filter((key) => !isNonEmptyString(source[key]));

  if (missing.length > 0) {
    if (strict) {
      throw new ServerConfigError(missing);
    }
    return null;
  }

  const config = source as Record<ServerConfigKey, string>;

  if (!isHttpsUrl(config.EMAIL_API_URL)) {
    throw new ServerConfigError(["EMAIL_API_URL"]);
  }

  if (!isEmailAddress(config.EMAIL_FROM)) {
    throw new ServerConfigError(["EMAIL_FROM"]);
  }

  // Authentication secrets must have enough entropy to protect short TACs
  // and opaque sessions. Keep the error key-only so configured values never
  // appear in logs or responses.
  const weakSecrets = (["AUTH_HMAC_SECRET", "SESSION_SECRET"] as const).filter(
    (key) => config[key].trim().length < 16,
  );
  if (weakSecrets.length > 0) throw new ServerConfigError(weakSecrets);

  return {
    EMAIL_API_URL: config.EMAIL_API_URL.trim(),
    EMAIL_API_KEY: config.EMAIL_API_KEY,
    EMAIL_FROM: config.EMAIL_FROM.trim(),
    AUTH_HMAC_SECRET: config.AUTH_HMAC_SECRET,
    SESSION_SECRET: config.SESSION_SECRET,
  };
}
