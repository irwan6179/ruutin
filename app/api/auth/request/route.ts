import { getD1 } from "../../../../db";
import { getServerConfig } from "../../../../server/config";
import { createEmailSender } from "../../../../server/email-adapter";
import {
  handleTacRequest,
  handleTacRequestBootstrap,
  type AuthRouteDependencies,
} from "../../../../server/auth-routes";
import { publicErrorResponse } from "../../../../server/error-safety";

export const dynamic = "force-dynamic";

function resolveDependencies(): AuthRouteDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    authHmacSecret: config.AUTH_HMAC_SECRET,
    sessionSecret: config.SESSION_SECRET,
    emailSender: createEmailSender(config),
  };
}

export async function GET(request: Request): Promise<Response> {
  return handleTacRequestBootstrap(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleTacRequest(request, resolveDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
