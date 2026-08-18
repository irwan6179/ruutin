import { getD1 } from "../../../../db";
import { getServerConfig } from "../../../../server/config";
import { handleTacVerify, type AuthRouteDependencies } from "../../../../server/auth-routes";
import { publicErrorResponse } from "../../../../server/error-safety";

export const dynamic = "force-dynamic";

function resolveDependencies(): AuthRouteDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    authHmacSecret: config.AUTH_HMAC_SECRET,
    sessionSecret: config.SESSION_SECRET,
    // Verification does not deliver email, but the dependency boundary keeps
    // all server configuration and route wiring uniform.
    emailSender: { send: async () => undefined },
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleTacVerify(request, resolveDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
