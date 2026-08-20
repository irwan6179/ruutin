import { env } from "cloudflare:workers";
import { loadServerConfig, type ServerConfig } from "./runtime-config";

/**
 * Resolve server configuration from the Sites/Workers runtime.
 *
 * This file must stay server-only. Keep calls at the boundary of future
 * server routes rather than importing it from a Client Component.
 */
export function getServerConfig(): ServerConfig | null {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  // Public pages do not call this boundary. Every server capability that
  // resolves it therefore fails closed when hosted variables are absent.
  return loadServerConfig(runtimeEnv, { strict: true });
}

/** Enabled only by the local Vite serve configuration, never by a build. */
export function isLocalDemoLoginEnabled(): boolean {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  return runtimeEnv.RUUTIN_LOCAL_DEMO_LOGIN === "enabled";
}

/** Exact private hostnames permitted by the local Vite serve configuration. */
export function getLocalDemoLoginHostnames(): readonly string[] {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const configured = runtimeEnv.RUUTIN_LOCAL_DEMO_HOSTS;
  if (typeof configured !== "string") return [];
  return configured
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
}
