import { getD1 } from "../../../../db";
import { getServerConfig } from "../../../../server/config";
import { handleParentSignOut, type AuthRouteDependencies } from "../../../../server/auth-routes";
import { publicErrorResponse } from "../../../../server/error-safety";

export const dynamic = "force-dynamic";

function resolveDependencies(): AuthRouteDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    authHmacSecret: config.AUTH_HMAC_SECRET,
    sessionSecret: config.SESSION_SECRET,
    emailSender: { send: async () => undefined },
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleParentSignOut(request, resolveDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
