import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const usePollingForFileChanges =
  process.env.CODEX_SANDBOX === "seatbelt" || process.env.RUUTIN_DEV_WATCH_POLLING === "true";

export default defineConfig(async ({ command, mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), "");
  const localDemoEnabled = localEnv.RUUTIN_LOCAL_DEMO_LOGIN === "enabled";
  const localDemoHosts = (localEnv.RUUTIN_LOCAL_DEMO_HOSTS ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      allowedHosts: localDemoHosts,
      ...(usePollingForFileChanges
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext({ prerender: true }),
      cloudflare({
        configPath: "./wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        ...(command === "serve"
          ? {
              config: {
                vars: {
                  RUUTIN_LOCAL_DEMO_LOGIN: localDemoEnabled ? "enabled" : "disabled",
                  RUUTIN_LOCAL_DEMO_HOSTS: localDemoHosts.join(","),
                  EMAIL_API_URL: localEnv.EMAIL_API_URL ?? "",
                  EMAIL_API_KEY: localEnv.EMAIL_API_KEY ?? "",
                  EMAIL_FROM: localEnv.EMAIL_FROM ?? "",
                  AUTH_HMAC_SECRET: localEnv.AUTH_HMAC_SECRET ?? "",
                  SESSION_SECRET: localEnv.SESSION_SECRET ?? "",
                },
              },
            }
          : {}),
      }),
    ],
  };
});
