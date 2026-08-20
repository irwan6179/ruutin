import { getD1 } from "../../../../db";
import {
  getLocalDemoLoginHostnames,
  getServerConfig,
  isLocalDemoLoginEnabled,
} from "../../../../server/config";
import { handleDevelopmentLogin } from "../../../../server/dev-auth";

export const dynamic = "force-dynamic";

function handle(request: Request): Promise<Response> {
  const enabled = isLocalDemoLoginEnabled();
  if (!enabled) {
    return handleDevelopmentLogin(request, {
      db: {} as ReturnType<typeof getD1>,
      sessionSecret: "disabled-local-demo-session-secret",
      enabled: false,
      allowedHostnames: [],
    });
  }
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return handleDevelopmentLogin(request, {
    db: getD1(),
    sessionSecret: config.SESSION_SECRET,
    enabled: true,
    allowedHostnames: getLocalDemoLoginHostnames(),
  });
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
