import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const usePollingForFileChanges =
  process.env.CODEX_SANDBOX === "seatbelt" || process.env.RUUTIN_DEV_WATCH_POLLING === "true";

export default defineConfig(async ({ command }) => {
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
    // These known, non-production values make the private local demo login
    // self-contained. They are omitted from builds and never enable email
    // delivery; hosted Sites variables remain mandatory in production. The
    // Tailnet hostname is HTTPS so the browser can retain Secure cookies.
    ...(command === "serve"
      ? {
          vars: {
            RUUTIN_LOCAL_DEMO_LOGIN: "enabled",
            RUUTIN_LOCAL_DEMO_HOSTS: "mohds-mac-mini.tail25cde9.ts.net",
            EMAIL_API_URL: "https://api.resend.com/emails",
            EMAIL_API_KEY: "local-demo-email-disabled",
            EMAIL_FROM: "demo@ruutin.local",
            AUTH_HMAC_SECRET: "local-demo-auth-hmac-secret-not-for-production",
            SESSION_SECRET: "local-demo-session-secret-not-for-production",
          },
        }
      : {}),
  };

  return {
    server: {
      allowedHosts: ["mohds-mac-mini.tail25cde9.ts.net"],
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
