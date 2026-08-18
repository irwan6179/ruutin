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
