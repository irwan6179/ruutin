import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

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

  const localBindingConfig = {
    main: "./worker/index.ts",
    // Resend is served behind Cloudflare. This flag makes outbound requests to
    // publicly reachable Workers use the public network instead of requiring a
    // private service binding.
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
    // Local-only values come from an ignored .env.local file. They are omitted
    // from builds and never enable email delivery; hosted Sites variables
    // remain mandatory in production.
    ...(command === "serve"
      ? {
          vars: {
            RUUTIN_LOCAL_DEMO_LOGIN: localDemoEnabled ? "enabled" : "disabled",
            RUUTIN_LOCAL_DEMO_HOSTS: localDemoHosts.join(","),
            EMAIL_API_URL: localEnv.EMAIL_API_URL ?? "",
            EMAIL_API_KEY: localEnv.EMAIL_API_KEY ?? "",
            EMAIL_FROM: localEnv.EMAIL_FROM ?? "",
            AUTH_HMAC_SECRET: localEnv.AUTH_HMAC_SECRET ?? "",
            SESSION_SECRET: localEnv.SESSION_SECRET ?? "",
          },
        }
      : {}),
  };

  return {
    server: {
      allowedHosts: localDemoHosts,
      ...(usePollingForFileChanges
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext({ prerender: true }),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
